import uuid
from typing import Annotated, Optional

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.session import Session as SessionModel


async def get_session(
    request: Request,
    x_session_id: Annotated[Optional[str], Header(alias="X-Session-Id")] = None,
    db: AsyncSession = Depends(get_db),
) -> SessionModel:
    sid = x_session_id or str(uuid.uuid4())
    row = await db.get(SessionModel, sid)
    if row is None:
        row = SessionModel(id=sid)
        db.add(row)
        await db.commit()
    # stash session id so the response middleware can echo it back to the client
    request.state.session_id = sid
    return row


def get_runner(request: Request):
    return request.app.state.runner
