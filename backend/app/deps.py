import uuid
from typing import Annotated, Optional

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.supabase import extract_bearer, verify_supabase_token
from app.db.session import get_db
from app.models.session import Session as SessionModel


async def get_session(
    request: Request,
    x_session_id: Annotated[Optional[str], Header(alias="X-Session-Id")] = None,
    authorization: Annotated[Optional[str], Header(alias="Authorization")] = None,
    db: AsyncSession = Depends(get_db),
) -> SessionModel:
    """Resolve the request's session row.

    Priority:
      1. Verified Supabase JWT → session keyed by the google user id
         (stable across browsers/devices for a given google account).
      2. X-Session-Id header → anonymous browser session (legacy flow).
      3. Fresh uuid → first-touch anon.
    """
    user = verify_supabase_token(extract_bearer(authorization) or "")

    if user is not None:
        sid = f"user:{user.id}"
        row = await db.get(SessionModel, sid)
        if row is None:
            row = SessionModel(id=sid, user_id=user.id, email=user.email)
            db.add(row)
            await db.commit()
        elif row.email != user.email or row.user_id != user.id:
            # keep email in sync if google display changes
            row.user_id = user.id
            row.email = user.email
            await db.commit()
        request.state.session_id = sid
        return row

    sid = x_session_id or str(uuid.uuid4())
    row = await db.get(SessionModel, sid)
    if row is None:
        row = SessionModel(id=sid)
        db.add(row)
        await db.commit()
    request.state.session_id = sid
    return row


def get_runner(request: Request):
    return request.app.state.runner
