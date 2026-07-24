const STORAGE_KEY = "ollama-cloud-chats";
const API_KEY_STORAGE = "ollama-cloud-api-key";

const els = {
  status: document.getElementById("connection-status"),
  apiKey: document.getElementById("api-key"),
  connectButton: document.getElementById("connect-button"),
  systemPrompt: document.getElementById("system-prompt"),
  modelSelect: document.getElementById("model-select"),
  chatList: document.getElementById("chat-list"),
  resetButton: document.getElementById("reset-button"),
  saveButton: document.getElementById("save-button"),
  deleteButton: document.getElementById("delete-button"),
  exportButton: document.getElementById("export-button"),
  shareButton: document.getElementById("share-button"),
  chatHistory: document.getElementById("chat-history"),
  chatForm: document.getElementById("chat-form"),
  userInput: document.getElementById("user-input"),
  sendButton: document.getElementById("send-button"),
  nameDialog: document.getElementById("name-dialog"),
  nameForm: document.getElementById("name-form"),
  chatName: document.getElementById("chat-name"),
  nameCancel: document.getElementById("name-cancel"),
  deleteDialog: document.getElementById("delete-dialog"),
  deleteMessage: document.getElementById("delete-message"),
  deleteCancel: document.getElementById("delete-cancel"),
  deleteConfirm: document.getElementById("delete-confirm"),
  errorDialog: document.getElementById("error-dialog"),
  errorMessage: document.getElementById("error-message"),
};

let messages = [];
let busy = false;
let abortController = null;
let currentChatName = "";
let pendingDeleteName = "";

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

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
  openDialog(els.errorDialog);
}

function cloneMessages(list) {
  return JSON.parse(JSON.stringify(list || []));
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

function updateChatList(selected) {
  const chats = loadChats();
  const names = Object.keys(chats).sort((a, b) => a.localeCompare(b));

  if (typeof selected === "string") {
    currentChatName = selected;
  }

  if (currentChatName && !names.includes(currentChatName)) {
    currentChatName = "";
  }

  if (!names.length) {
    els.chatList.innerHTML = `<div class="chat-list-empty">No saved chats yet</div>`;
    return;
  }

  els.chatList.innerHTML = "";
  for (const name of names) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-list-item${name === currentChatName ? " active" : ""}`;
    button.textContent = name;
    button.dataset.chatName = name;
    button.addEventListener("click", () => loadChatByName(name));
    els.chatList.appendChild(button);
  }
}

function renderEmpty() {
  els.chatHistory.innerHTML = `
    <div class="empty-state">
      <p class="empty-title">Start a conversation</p>
      <p class="empty-text">
        Type your message in the box at the bottom, then press
        <strong>Enter</strong> or click <strong>Send</strong>.
      </p>
      <p class="empty-hint">
        Connect with your API key and choose a model first.
      </p>
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
  currentChatName = "";
  updateChatList();
  renderEmpty();
}

function saveChat() {
  if (busy) return;

  if (!messages.length) {
    showError("Send at least one message before saving a chat.");
    return;
  }

  els.chatName.value = currentChatName || "";
  openDialog(els.nameDialog);
  requestAnimationFrame(() => {
    els.chatName.focus();
    els.chatName.select();
  });
}

function commitSave(name) {
  const chats = loadChats();
  chats[name] = {
    system: els.systemPrompt.value,
    model: els.modelSelect.value,
    messages: cloneMessages(messages),
    updatedAt: Date.now(),
  };
  persistChats(chats);
  currentChatName = name;
  updateChatList(name);
  setStatus(`Saved: ${name}`, "ok");
}

function getExportPayload() {
  return {
    name: currentChatName || "untitled-chat",
    model: els.modelSelect.value || "",
    system: els.systemPrompt.value || "",
    messages: cloneMessages(messages),
    exportedAt: new Date().toISOString(),
  };
}

function chatToMarkdown(payload) {
  const lines = [
    `# ${payload.name}`,
    "",
    `- Model: ${payload.model || "n/a"}`,
    `- Exported: ${payload.exportedAt}`,
    "",
  ];

  if (payload.system) {
    lines.push("## System Prompt", "", payload.system, "");
  }

  lines.push("## Conversation", "");
  for (const message of payload.messages) {
    const role = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
    lines.push(`### ${role}`, "", message.content || "", "");
  }

  return lines.join("\n");
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(name) {
  return String(name || "chat")
    .trim()
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "chat";
}

function exportChat() {
  if (!messages.length) {
    showError("Chat something first, then export.");
    return;
  }

  const payload = getExportPayload();
  const base = safeFilename(payload.name);
  downloadTextFile(
    `${base}.md`,
    chatToMarkdown(payload),
    "text/markdown;charset=utf-8",
  );
  downloadTextFile(
    `${base}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8",
  );
  setStatus(`Exported: ${payload.name}`, "ok");
}

async function shareChat() {
  if (!messages.length) {
    showError("Chat something first, then share.");
    return;
  }

  const payload = getExportPayload();
  const text = chatToMarkdown(payload);
  const title = `Ollama Cloud · ${payload.name}`;

  try {
    if (navigator.share) {
      const shareData = { title, text };
      if (navigator.canShare && !navigator.canShare(shareData)) {
        throw new Error("Share not supported for this content");
      }
      await navigator.share(shareData);
      setStatus("Shared", "ok");
      return;
    }

    await navigator.clipboard.writeText(text);
    setStatus("Copied chat to clipboard", "ok");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied chat to clipboard", "ok");
    } catch {
      showError("Could not share or copy this chat.");
    }
  }
}

function deleteChat() {
  if (busy) return;

  const name = currentChatName;
  if (!name) {
    showError("Click a saved chat in History first, then click Delete.");
    return;
  }

  pendingDeleteName = name;
  els.deleteMessage.textContent = `Delete saved chat "${name}"? This cannot be undone.`;
  openDialog(els.deleteDialog);
}

function confirmDeleteChat() {
  const name = pendingDeleteName;
  pendingDeleteName = "";
  closeDialog(els.deleteDialog);

  if (!name) return;

  const chats = loadChats();
  if (!(name in chats)) {
    showError(`No saved chat named "${name}".`);
    updateChatList();
    return;
  }

  delete chats[name];
  persistChats(chats);
  currentChatName = "";
  updateChatList();
  messages = [];
  renderEmpty();
  setStatus(`Deleted: ${name}`, "ok");
}

function loadChatByName(name) {
  if (busy) {
    showError("Wait for the current reply to finish before loading a chat.");
    return;
  }

  if (!name) return;

  const chats = loadChats();
  const chat = chats[name];
  if (!chat) {
    showError(`Saved chat "${name}" was not found.`);
    updateChatList();
    return;
  }

  currentChatName = name;
  updateChatList(name);
  els.systemPrompt.value = chat.system || "";

  if (chat.model) {
    let option = [...els.modelSelect.options].find((o) => o.value === chat.model);
    if (!option) {
      option = document.createElement("option");
      option.value = chat.model;
      option.textContent = chat.model;
      els.modelSelect.appendChild(option);
    }
    els.modelSelect.value = chat.model;
  }

  messages = cloneMessages(chat.messages);
  renderMessages();
  setStatus(`Loaded: ${name}`, "ok");
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
els.exportButton.addEventListener("click", exportChat);
els.shareButton.addEventListener("click", shareChat);

els.nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.chatName.value.trim();
  if (!name) {
    showError("Enter a name for this chat.");
    return;
  }
  commitSave(name);
  closeDialog(els.nameDialog);
});

els.nameCancel.addEventListener("click", (event) => {
  event.preventDefault();
  closeDialog(els.nameDialog);
});

els.nameDialog.addEventListener("close", () => {
  els.chatName.value = "";
});

els.deleteConfirm.addEventListener("click", confirmDeleteChat);
els.deleteCancel.addEventListener("click", () => {
  pendingDeleteName = "";
  closeDialog(els.deleteDialog);
});
els.deleteDialog.addEventListener("close", () => {
  pendingDeleteName = "";
});

restoreApiKey();
updateChatList();
renderEmpty();
autoGrow();

if (getApiKey()) {
  populateModels({ silent: true });
} else {
  setStatus("Enter API key", "err");
}
