"""Verify Supabase-issued JWTs on incoming requests.

Supabase's legacy signing mode uses HS256 with a shared symmetric secret
(SUPABASE_JWT_SECRET). Verify locally — no network roundtrip needed.

If SUPABASE_JWT_SECRET isn't configured we fail closed (treat as anon).
That way the app still works in offline dev without forcing devs to
wire real auth.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import jwt

from app.config.settings import get_settings


log = logging.getLogger("iris.auth")


@dataclass(slots=True)
class AuthedUser:
    id: str
    email: Optional[str]


def verify_supabase_token(token: str) -> Optional[AuthedUser]:
    """Decode + verify a Supabase HS256 JWT. Returns None on any failure."""
    settings = get_settings()
    secret = settings.supabase_jwt_secret
    if not secret or not token:
        return None

    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
            # supabase sets iss to "{project_ref}.supabase.co/auth/v1" on new
            # projects and just "supabase" on older ones. skip issuer check to
            # stay compatible.
            options={"verify_iss": False},
        )
    except jwt.ExpiredSignatureError:
        log.info("rejected expired supabase token")
        return None
    except jwt.InvalidTokenError as e:
        log.info("rejected invalid supabase token: %s", e)
        return None

    sub = claims.get("sub")
    if not sub:
        return None

    email = claims.get("email") or (claims.get("user_metadata") or {}).get("email")
    return AuthedUser(id=str(sub), email=email)


def extract_bearer(authorization_header: Optional[str]) -> Optional[str]:
    if not authorization_header:
        return None
    parts = authorization_header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None
