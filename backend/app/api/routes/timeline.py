from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_session
from app.models.project import Project
from app.models.session import Session as SessionModel
from app.schemas.timeline import TimelineOut, TimelineSegment
from app.services import storage
from app.services.timeline_builder import build_timeline

router = APIRouter(tags=["timeline"])


@router.get("/timeline/{project_id}", response_model=TimelineOut)
async def get_timeline(
    project_id: str,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    proj = await db.get(Project, project_id)
    if proj is None or proj.session_id != session.id:
        raise HTTPException(status_code=404, detail="project not found")

    items = await build_timeline(db, proj)

    # re-sign stored URLs so reels reopened past the presign window still
    # play. normalize_url_like extracts the S3 key from even a stale
    # presigned URL and re-signs.
    return TimelineOut(
        project_id=proj.id,
        duration=proj.duration,
        segments=[
            TimelineSegment(
                start_ts=it.start_ts,
                end_ts=it.end_ts,
                source=it.source,
                url=storage.normalize_url_like(it.url, fallback=it.url),
                audio=it.audio,
            )
            for it in items
        ],
    )
