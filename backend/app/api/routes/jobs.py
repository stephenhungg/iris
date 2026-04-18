from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.deps import get_session
from app.models.job import Job
from app.models.project import Project
from app.models.session import Session as SessionModel
from app.schemas.job import JobOut, VariantOut

router = APIRouter(tags=["jobs"])


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(
    job_id: str,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    job = (
        await db.execute(
            select(Job).where(Job.id == job_id).options(selectinload(Job.variants))
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")

    # enforce session ownership through the project
    proj = await db.get(Project, job.project_id)
    if proj is None or proj.session_id != session.id:
        raise HTTPException(status_code=404, detail="job not found")

    return JobOut(
        job_id=job.id,
        kind=job.kind,
        status=job.status,  # type: ignore[arg-type]
        error=job.error,
        variants=[
            VariantOut(
                id=v.id,
                index=v.index,
                status=v.status,  # type: ignore[arg-type]
                url=v.url,
                description=v.description,
                visual_coherence=v.visual_coherence,
                prompt_adherence=v.prompt_adherence,
                error=v.error,
            )
            for v in sorted(job.variants, key=lambda v: v.index)
        ],
    )
