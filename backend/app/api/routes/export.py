from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_runner, get_session
from app.models.job import Job
from app.models.project import Project
from app.models.session import Session as SessionModel
from app.schemas.export import ExportRequest, ExportResponse, ExportStatus
from app.workers import export_job

router = APIRouter(tags=["export"])


@router.post("/export", response_model=ExportResponse)
async def export(
    body: ExportRequest,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
    runner = Depends(get_runner),
):
    proj = await db.get(Project, body.project_id)
    if proj is None or proj.session_id != session.id:
        raise HTTPException(status_code=404, detail="project not found")

    job = Job(
        project_id=proj.id,
        kind="export",
        status="pending",
        payload={"format": body.format},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    runner.submit(job.id, lambda: export_job.run(job.id))
    return ExportResponse(export_job_id=job.id)


@router.get("/export/{export_job_id}", response_model=ExportStatus)
async def get_export(
    export_job_id: str,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(Job, export_job_id)
    if job is None or job.kind != "export":
        raise HTTPException(status_code=404, detail="export job not found")
    proj = await db.get(Project, job.project_id)
    if proj is None or proj.session_id != session.id:
        raise HTTPException(status_code=404, detail="export job not found")

    payload = job.payload or {}
    return ExportStatus(
        export_job_id=job.id,
        status=job.status,  # type: ignore[arg-type]
        export_url=payload.get("export_url"),
        error=job.error,
    )
