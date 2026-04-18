from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.deps import get_session
from app.models.entity import Entity
from app.models.project import Project
from app.models.segment import Segment
from app.models.session import Session as SessionModel
from app.schemas.project import EntitySummary, ProjectOut, SegmentOut

router = APIRouter(tags=["projects"])


async def _load_owned_project(
    project_id: str,
    session: SessionModel,
    db: AsyncSession,
) -> Project:
    proj = await db.get(Project, project_id)
    if proj is None or proj.session_id != session.id:
        raise HTTPException(status_code=404, detail="project not found")
    return proj


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    proj = await _load_owned_project(project_id, session, db)

    segs = (
        await db.execute(
            select(Segment)
            .where(Segment.project_id == project_id, Segment.active == True)  # noqa: E712
            .order_by(Segment.order_index, Segment.start_ts)
        )
    ).scalars().all()

    ents = (
        await db.execute(
            select(Entity)
            .where(Entity.project_id == project_id)
            .options(selectinload(Entity.appearances))
        )
    ).scalars().all()

    return ProjectOut(
        project_id=proj.id,
        video_url=proj.video_url,
        duration=proj.duration,
        fps=proj.fps,
        width=proj.width,
        height=proj.height,
        segments=[
            SegmentOut(
                id=s.id,
                start_ts=s.start_ts,
                end_ts=s.end_ts,
                source=s.source,  # type: ignore[arg-type]
                url=s.url,
                variant_id=s.variant_id,
                order_index=s.order_index,
            )
            for s in segs
        ],
        entities=[
            EntitySummary(
                id=e.id,
                description=e.description,
                category=e.category,
                appearance_count=len(e.appearances),
            )
            for e in ents
        ],
    )
