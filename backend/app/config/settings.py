from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # database url. defaults to local sqlite so the app boots without postgres.
    # for real deploys set DATABASE_URL=postgresql+asyncpg://iris:iris@host:5432/iris
    database_url: str = "sqlite+aiosqlite:///./iris.db"

    # local scratch dir — ffmpeg needs real file paths, so we write here first
    # and upload to vultr on publish(). once s3 is wired this is just a cache,
    # never user-facing.
    storage_path: Path = Path("./storage")

    gemini_api_key: str = ""
    runway_api_key: str = ""
    elevenlabs_api_key: str = ""

    # legacy supabase jwt signing secret. when set, the backend verifies
    # incoming Bearer tokens and scopes data by the google user id. when
    # unset, the app falls back to anon session cookies (offline dev).
    supabase_jwt_secret: str = ""

    max_video_seconds: int = 120

    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]

    # when true, worker calls resolve to ai/services/_stubs.py
    use_ai_stubs: bool = True

    # ── vultr object storage ────────────────────────────────────────
    # S3-compatible. empty values disable the integration and storage
    # falls back to the local scratch dir (behaves like the old /media
    # setup — handy for offline dev).
    vultr_s3_endpoint: str = ""
    vultr_s3_region: str = "ewr1"
    vultr_s3_bucket: str = ""
    vultr_s3_access_key: str = ""
    vultr_s3_secret_key: str = ""
    # "presigned" → bucket stays private, backend mints GET urls
    # "public"    → urls are https://{bucket}.{host}/{key} (requires
    #               bucket read policy set to public-read)
    media_url_mode: str = "presigned"
    presign_expiry: int = 7 * 24 * 3600  # 7 days, max for sigv4

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def s3_enabled(self) -> bool:
        return bool(
            self.vultr_s3_endpoint
            and self.vultr_s3_bucket
            and self.vultr_s3_access_key
            and self.vultr_s3_secret_key
        )


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # scratch dirs — always exist locally even in s3 mode, since ffmpeg
    # writes here first.
    s.storage_path.mkdir(parents=True, exist_ok=True)
    for sub in ("uploads", "clips", "variants", "stitched", "exports", "narration", "keyframes"):
        (s.storage_path / sub).mkdir(parents=True, exist_ok=True)
    return s
