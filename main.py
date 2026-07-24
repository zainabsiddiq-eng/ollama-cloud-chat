from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from services.ollama_cloud import OllamaCloudError, OllamaCloudService

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Ollama Cloud Chat UI")
ollama = OllamaCloudService()


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    system: str | None = None
    api_key: str | None = None


def _api_key_from_request(
    body_key: str | None = None,
    header_key: str | None = None,
) -> str | None:
    return (body_key or header_key or "").strip() or None


@app.get("/api/health")
async def health():
    return {"status": "ok", "provider": "ollama-cloud"}


@app.get("/api/models")
async def list_models(x_ollama_api_key: str | None = Header(default=None)):
    try:
        models = await ollama.list_models(
            api_key=_api_key_from_request(header_key=x_ollama_api_key)
        )
    except OllamaCloudError as exc:
        raise HTTPException(
            status_code=exc.status_code or 502,
            detail=str(exc),
        ) from exc

    names = sorted(
        {
            m.get("name") or m.get("model")
            for m in models
            if m.get("name") or m.get("model")
        }
    )
    return {"models": names}


@app.post("/api/chat")
async def chat(
    request: ChatRequest,
    x_ollama_api_key: str | None = Header(default=None),
):
    messages: list[dict[str, str]] = []
    api_key = _api_key_from_request(request.api_key, x_ollama_api_key)

    if request.system and request.system.strip():
        messages.append({"role": "system", "content": request.system.strip()})

    for message in request.messages:
        if message.role == "system":
            continue
        content = message.content.strip()
        if content:
            messages.append({"role": message.role, "content": content})

    if not any(m["role"] == "user" for m in messages):
        raise HTTPException(
            status_code=400,
            detail="At least one user message is required.",
        )

    async def event_stream():
        try:
            async for chunk in ollama.stream_chat(
                model=request.model,
                messages=messages,
                api_key=api_key,
            ):
                yield chunk
        except OllamaCloudError as exc:
            yield f"\n\n[Error] {exc}"

    return StreamingResponse(
        event_stream(),
        media_type="text/plain; charset=utf-8",
    )


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
