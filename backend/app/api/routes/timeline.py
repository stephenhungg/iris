from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_session
from app.models.project import Project
from app.models.segment import Segment
from app.models.session import Session as SessionModel
from app.schemas.timeline import TimelineOut, TimelineSegment
from app.services import storage

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

    generated = (
        await db.execute(
            select(Segment)
            .where(
                Segment.project_id == project_id,
                Segment.source == "generated",
                Segment.active == True,  # noqa: E712
            )
            .order_by(Segment.start_ts)
        )
    ).scalars().all()

    # re-sign the stored URLs so reels reopened after the 7-day presign
    # window still play. same trick as /api/projects.
    base_url = storage.normalize_url_like(proj.video_url, fallback=proj.video_url)

    # Timeline construction: walk from 0..duration and fill gaps between
    # generated segments with implicit "original" segments pointing at the
    # source video. Overlapping generated segments should be pre-flattened
    # at accept time, so we assume non-overlap here.
    items: list[TimelineSegment] = []
    cursor = 0.0
    for seg in generated:
        if seg.start_ts > cursor + 1e-3:
            items.append(
                TimelineSegment(
                    start_ts=cursor,
                    end_ts=seg.start_ts,
                    source="original",
                    url=base_url,
                    audio=True,
                )
            )
        items.append(
            TimelineSegment(
                start_ts=seg.start_ts,
                end_ts=seg.end_ts,
                source="generated",
                url=storage.normalize_url_like(seg.url, fallback=seg.url),
                audio=False,
            )
        )
        cursor = seg.end_ts

    if cursor < proj.duration - 1e-3:
        items.append(
            TimelineSegment(
                start_ts=cursor,
                end_ts=proj.duration,
                source="original",
                url=base_url,
                audio=True,
            )
        )

    # if no generated segments at all, return a single original span
    if not items:
        items.append(
            TimelineSegment(
                start_ts=0.0,
                end_ts=proj.duration,
                source="original",
                url=base_url,
                audio=True,
            )
        )

    return TimelineOut(
        project_id=proj.id,
        duration=proj.duration,
        segments=items,
    )
