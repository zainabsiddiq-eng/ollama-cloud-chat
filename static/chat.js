const STORAGE_KEY = "ollama-cloud-chats";
const API_KEY_STORAGE = "ollama-cloud-api-key";

const els = {
  status: document.getElementById("connection-status"),
  apiKey: document.getElementById("api-key"),
  connectButton: document.getElementById("connect-button"),
  systemPrompt: document.getElementById("system-prompt"),
  modelSelect: document.getElementById("model-select"),
  chatSelect: document.getElementById("chat-select"),
  resetButton: document.getElementById("reset-button"),
  saveButton: document.getElementById("save-button"),
  deleteButton: document.getElementById("delete-button"),
  chatHistory: document.getElementById("chat-history"),
  chatForm: document.getElementById("chat-form"),
  userInput: document.getElementById("user-input"),
  sendButton: document.getElementById("send-button"),
  nameDialog: document.getElementById("name-dialog"),
  nameForm: document.getElementById("name-form"),
  chatName: document.getElementById("chat-name"),
  nameCancel: document.getElementById("name-cancel"),
  errorDialog: document.getElementById("error-dialog"),
  errorMessage: document.getElementById("error-message"),
};

let messages = [];
let busy = false;
let abortController = null;

function getApiKey() {
  return (els.apiKey.value || "").trim();
}

function saveApiKey() {
  const key = getApiKey();
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
  else localStorage.removeItem(API_KEY_STORAGE);
}

function restoreApiKey() {
  els.apiKey.value = localStorage.getItem(API_KEY_STORAGE) || "";
}

function authHeaders(extra = {}) {
  const key = getApiKey();
  const headers = { ...extra };
  if (key) headers["X-Ollama-Api-Key"] = key;
  return headers;
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorDialog.showModal();
}

function loadChats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistChats(chats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function updateChatList(selected = "") {
  const chats = loadChats();
  const names = Object.keys(chats).sort((a, b) => a.localeCompare(b));
  els.chatSelect.innerHTML = `<option value="">Select a chat</option>`;
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === selected) option.selected = true;
    els.chatSelect.appendChild(option);
  }
}

function renderEmpty() {
  els.chatHistory.innerHTML = `
    <div class="empty-state">
      Paste your Ollama API key, click Connect, pick a model, then start chatting.
      Saved chats stay in this browser.
    </div>
  `;
}

function renderMessages() {
  if (!messages.length) {
    renderEmpty();
    return;
  }

  els.chatHistory.innerHTML = "";
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const isLast = i === messages.length - 1;
    const waiting =
      busy &&
      isLast &&
      message.role === "assistant" &&
      !message.content;

    const bubble = document.createElement("div");
    bubble.className = `message ${message.role}${waiting ? " waiting" : ""}`;

    if (waiting) {
      bubble.innerHTML = `
        <span class="waiting-label">Waiting</span>
        <span class="waiting-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      `;
    } else {
      bubble.textContent = message.content;
    }

    if (message.role === "assistant" && message.content) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy-button";
      copy.title = "Copy";
      copy.textContent = "⎘";
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(message.content);
        copy.textContent = "✓";
        setTimeout(() => {
          copy.textContent = "⎘";
        }, 900);
      });
      bubble.appendChild(copy);
    }

    els.chatHistory.appendChild(bubble);
  }

  els.chatHistory.scrollTop = els.chatHistory.scrollHeight;
}

function autoGrow() {
  els.userInput.style.height = "auto";
  els.userInput.style.height = `${Math.min(els.userInput.scrollHeight, 180)}px`;
}

async function populateModels({ silent = false } = {}) {
  const key = getApiKey();
  if (!key) {
    els.modelSelect.innerHTML = `<option value="">Enter API key to connect…</option>`;
    setStatus("Enter API key", "err");
    if (!silent) showError("Paste your Ollama API key, then click Connect.");
    return;
  }

  setStatus("Connecting…");
  els.connectButton.disabled = true;
  els.connectButton.textContent = "Connecting…";

  try {
    const response = await fetch("/api/models", {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const models = data.models || [];
    els.modelSelect.innerHTML = "";

    if (!models.length) {
      els.modelSelect.innerHTML = `<option value="">No models found</option>`;
      setStatus("No models", "err");
      return;
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      els.modelSelect.appendChild(option);
    }

    const preferred = models.find((m) => m.includes("gpt-oss")) || models[0];
    els.modelSelect.value = preferred;
    saveApiKey();
    setStatus("Cloud connected", "ok");
  } catch (error) {
    els.modelSelect.innerHTML = `<option value="">Failed to load</option>`;
    setStatus("Disconnected", "err");
    if (!silent) showError(String(error.message || error));
  } finally {
    els.connectButton.disabled = false;
    els.connectButton.textContent = "Connect";
  }
}

function resetChat() {
  if (busy) return;
  messages = [];
  els.chatSelect.value = "";
  renderEmpty();
}

function saveChat() {
  if (!messages.length) return;
  els.chatName.value = els.chatSelect.value || "";
  els.nameDialog.showModal();
  els.chatName.focus();
}

function commitSave(name) {
  const chats = loadChats();
  chats[name] = {
    system: els.systemPrompt.value,
    model: els.modelSelect.value,
    messages,
    updatedAt: Date.now(),
  };
  persistChats(chats);
  updateChatList(name);
}

function deleteChat() {
  const name = els.chatSelect.value;
  if (!name) return;
  const chats = loadChats();
  delete chats[name];
  persistChats(chats);
  updateChatList();
  resetChat();
}

function loadSelectedChat() {
  const name = els.chatSelect.value;
  if (!name) return;
  const chats = loadChats();
  const chat = chats[name];
  if (!chat) return;

  els.systemPrompt.value = chat.system || "";
  if (chat.model) {
    const option = [...els.modelSelect.options].find((o) => o.value === chat.model);
    if (option) els.modelSelect.value = chat.model;
  }
  messages = Array.isArray(chat.messages) ? chat.messages : [];
  renderMessages();
}

async function sendMessage(event) {
  event.preventDefault();
  if (busy) return;

  const text = els.userInput.value.trim();
  const model = els.modelSelect.value;
  const apiKey = getApiKey();
  if (!apiKey) {
    showError("Paste your Ollama API key, then click Connect.");
    return;
  }
  if (!text || !model) return;

  messages.push({ role: "user", content: text });
  els.userInput.value = "";
  autoGrow();
  renderMessages();

  const assistant = { role: "assistant", content: "" };
  messages.push(assistant);

  busy = true;
  els.sendButton.disabled = true;
  els.sendButton.textContent = "Stop";
  setStatus("Generating…");
  abortController = new AbortController();
  renderMessages();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      signal: abortController.signal,
      body: JSON.stringify({
        model,
        system: els.systemPrompt.value,
        messages: messages.slice(0, -1),
        api_key: apiKey,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    assistant.content = fullText.trim() || "(empty response)";
    setStatus("Cloud connected", "ok");
    renderMessages();
  } catch (error) {
    if (error.name === "AbortError") {
      assistant.content = "(stopped)";
      setStatus("Cloud connected", "ok");
    } else {
      assistant.content = `[Error] ${error.message || error}`;
      setStatus("Request failed", "err");
    }
    renderMessages();
  } finally {
    busy = false;
    abortController = null;
    els.sendButton.disabled = false;
    els.sendButton.textContent = "Send";
    renderMessages();
    els.userInput.focus();
  }
}

els.chatForm.addEventListener("submit", (event) => {
  if (busy && abortController) {
    event.preventDefault();
    abortController.abort();
    return;
  }
  sendMessage(event);
});

els.userInput.addEventListener("input", autoGrow);
els.userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
});

els.connectButton.addEventListener("click", () => populateModels());
els.apiKey.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    populateModels();
  }
});
els.apiKey.addEventListener("change", saveApiKey);

els.resetButton.addEventListener("click", resetChat);
els.saveButton.addEventListener("click", saveChat);
els.deleteButton.addEventListener("click", deleteChat);
els.chatSelect.addEventListener("change", loadSelectedChat);

els.nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.chatName.value.trim();
  if (!name) return;
  commitSave(name);
  els.nameDialog.close();
});

els.nameCancel.addEventListener("click", () => els.nameDialog.close());

restoreApiKey();
updateChatList();
renderEmpty();
autoGrow();

if (getApiKey()) {
  populateModels({ silent: true });
} else {
  setStatus("Enter API key", "err");
}
