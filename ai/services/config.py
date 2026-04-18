"""Shared config for all AI services. Reads from environment variables."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str = Field(..., alias="GEMINI_API_KEY")
    elevenlabs_api_key: str = Field("", alias="ELEVENLABS_API_KEY")
    storage_path: str = Field("./storage", alias="STORAGE_PATH")
    gpu_worker_url: str = Field("http://localhost:8001", alias="GPU_WORKER_URL")

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
