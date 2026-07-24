from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from app.config.settings import get_settings


class OllamaCloudError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class OllamaCloudService:
    def __init__(self) -> None:
        settings = get_settings()
        self.host = settings.ollama_host.rstrip("/")
        self.default_api_key = settings.ollama_api_key

    def _resolve_key(self, api_key: str | None = None) -> str:
        key = (api_key or "").strip() or self.default_api_key
        if not key:
            raise OllamaCloudError(
                "Enter your Ollama API key in the UI to connect.",
                status_code=401,
            )
        return key

    def _headers(self, api_key: str | None = None) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._resolve_key(api_key)}",
            "Content-Type": "application/json",
        }

    async def list_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.host}/api/tags",
                headers=self._headers(api_key),
            )
            if response.status_code >= 400:
                raise OllamaCloudError(
                    response.text or "Failed to list models",
                    status_code=response.status_code,
                )
            data = response.json()
            return data.get("models", [])

    async def stream_chat(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        api_key: str | None = None,
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{self.host}/api/chat",
                headers=self._headers(api_key),
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    raise OllamaCloudError(
                        body.decode("utf-8", errors="replace")
                        or "Chat request failed",
                        status_code=response.status_code,
                    )

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    content = (chunk.get("message") or {}).get("content") or ""
                    if content:
                        yield content

                    if chunk.get("done"):
                        break
