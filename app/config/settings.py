from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ollama_api_key: str = ""
    ollama_host: str = "https://ollama.com"
    mongodb_url: str = "mongodb://localhost:27017"
    database_name: str = "cloud_chat"


@lru_cache
def get_settings() -> Settings:
    return Settings()
