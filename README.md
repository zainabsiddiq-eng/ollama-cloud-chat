# Ollama Cloud Chat

A simple web chat UI for testing **Ollama Cloud** models (`ollama.com`), similar to [ollama-ui](https://ollama-ui.github.io/ollama-ui/) but cloud-based.

Paste your API key in the UI, pick a model, set an optional system prompt, and chat. Replies show a waiting indicator, then the full answer when generation finishes.

## Features

- Connect with an Ollama Cloud API key from the UI
- Model picker (loaded from `ollama.com`)
- System prompt
- Save / load / delete chat history (browser localStorage)
- Waiting indicator while generating
- Full response shown when complete (not streamed into the UI)

## Requirements

- Python 3.11+
- An [Ollama Cloud API key](https://ollama.com/settings/keys)

## Setup

```bash
cd /Users/macbook/Desktop/fast
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Optional: copy env values into `.env` (API key can also be entered only in the UI):

```env
OLLAMA_API_KEY=
OLLAMA_HOST=https://ollama.com
```

## Run

```bash
source venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000)

## How to use

1. Paste your Ollama API key in **Ollama API Key**
2. Click **Connect**
3. Choose a **Model**
4. Optionally set a **System Prompt**
5. Send a message

Your key is stored in the browser (localStorage) for this site only.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Chat UI |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/models` | List cloud models (`X-Ollama-Api-Key` header) |
| `POST` | `/api/chat` | Chat completion (streams from Ollama; UI waits for full text) |

### Example chat request

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Ollama-Api-Key: YOUR_KEY" \
  -d '{
    "model": "gpt-oss:20b",
    "system": "You are a helpful assistant.",
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'
```

## Project structure

```
fast/
├── main.py                 # FastAPI app + routes
├── app/config/settings.py  # Env settings
├── services/ollama_cloud.py
├── static/                 # Chat UI (HTML/CSS/JS)
├── requirements.txt
└── .env                    # Local secrets (not committed)
```

## Notes

- Do not commit `.env` or share your API key.
- This app proxies requests to `https://ollama.com` so the key is sent to your local backend, not used as a direct browser-to-Ollama call for model listing/chat.
