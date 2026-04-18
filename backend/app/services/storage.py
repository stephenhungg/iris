"""Local-disk storage helpers.

Everything is scoped under settings.storage_path and exposed via the
/media static mount in main.py.
"""
from __future__ import annotations

import uuid
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from app.config.settings import get_settings


settings = get_settings()


def _new_name(ext: str) -> str:
    ext = ext.lstrip(".")
    return f"{uuid.uuid4().hex}.{ext}"


def path_for(category: str, filename: str) -> Path:
    p = settings.storage_path / category / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def public_url(category: str, filename: str) -> str:
    return f"/media/{category}/{filename}"


def url_for_path(p: Path) -> str:
    rel = p.resolve().relative_to(settings.storage_path.resolve())
    return f"/media/{rel.as_posix()}"


def path_from_url(url: str) -> Path:
    if url.startswith("/media/"):
        rel = url[len("/media/") :]
        return settings.storage_path / rel
    return Path(url)


async def save_upload(upload: UploadFile, category: str = "uploads") -> tuple[Path, str]:
    """Stream an UploadFile to disk in chunks to avoid loading into memory."""
    suffix = Path(upload.filename or "video.mp4").suffix or ".mp4"
    name = _new_name(suffix)
    dest = path_for(category, name)
    async with aiofiles.open(dest, "wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            await out.write(chunk)
    return dest, public_url(category, name)


def new_path(category: str, ext: str) -> tuple[Path, str]:
    name = _new_name(ext)
    return path_for(category, name), public_url(category, name)


async def write_bytes(category: str, ext: str, data: bytes) -> tuple[Path, str]:
    p, url = new_path(category, ext)
    async with aiofiles.open(p, "wb") as f:
        await f.write(data)
    return p, url
