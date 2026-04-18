from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # database url. defaults to local sqlite so the app boots without postgres.
    # for real deploys set DATABASE_URL=postgresql+asyncpg://iris:iris@host:5432/iris
    database_url: str = "sqlite+aiosqlite:///./iris.db"

    storage_path: Path = Path("./storage")

    gemini_api_key: str = ""
    runway_api_key: str = ""
    elevenlabs_api_key: str = ""

    max_video_seconds: int = 120

    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]

    # when true, worker calls resolve to ai/services/_stubs.py
    use_ai_stubs: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.storage_path.mkdir(parents=True, exist_ok=True)
    (s.storage_path / "uploads").mkdir(parents=True, exist_ok=True)
    (s.storage_path / "clips").mkdir(parents=True, exist_ok=True)
    (s.storage_path / "variants").mkdir(parents=True, exist_ok=True)
    (s.storage_path / "stitched").mkdir(parents=True, exist_ok=True)
    (s.storage_path / "exports").mkdir(parents=True, exist_ok=True)
    (s.storage_path / "narration").mkdir(parents=True, exist_ok=True)
    (s.storage_path / "keyframes").mkdir(parents=True, exist_ok=True)
    return s
