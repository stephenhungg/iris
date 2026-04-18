from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.deps import get_runner, get_session
from app.models.job import Job, Variant
from app.models.project import Project
from app.models.segment import Segment
from app.models.session import Session as SessionModel
from app.schemas.accept import AcceptRequest, AcceptResponse
from app.services import ffmpeg, storage
from app.workers import entity_job

router = APIRouter(tags=["accept"])


@router.post("/accept", response_model=AcceptResponse)
async def accept(
    body: AcceptRequest,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
    runner = Depends(get_runner),
):
    job = (
        await db.execute(
            select(Job).where(Job.id == body.job_id).options(selectinload(Job.variants))
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")

    proj = await db.get(Project, job.project_id)
    if proj is None or proj.session_id != session.id:
        raise HTTPException(status_code=404, detail="job not found")

    variant = next((v for v in job.variants if v.index == body.variant_index), None)
    if variant is None or variant.status != "done" or not variant.url:
        raise HTTPException(status_code=422, detail="variant not ready")

    if job.start_ts is None or job.end_ts is None:
        raise HTTPException(status_code=422, detail="job has no segment range")

    # normalize fps on the generated clip before stitching so xfade doesn't jitter
    variant_path = storage.path_from_url(variant.url)
    normalized_path, _ = storage.new_path("variants", "mp4")
    try:
        await ffmpeg.normalize_fps(variant_path, proj.fps, normalized_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"fps normalize failed: {e}")

    # crossfade-stitch into a brand-new project video
    stitched_path, stitched_url = storage.new_path("stitched", "mp4")
    segment_duration = job.end_ts - job.start_ts
    try:
        await ffmpeg.stitch_crossfade(
            base=proj.video_path,
            replacement=normalized_path,
            at_ts=job.start_ts,
            duration=segment_duration,
            out=stitched_path,
        )
    except Exception as e:
        # fallback: hard cut
        try:
            await ffmpeg.simple_replace(
                base=proj.video_path,
                replacement=normalized_path,
                at_ts=job.start_ts,
                duration=segment_duration,
                out=stitched_path,
            )
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"stitch failed: {e2}")

    # swap project video to the stitched output (append-only history via new paths)
    proj.video_path = str(stitched_path)
    proj.video_url = stitched_url

    # deactivate any generated segments overlapping this range, then append ours
    overlapping = (
        await db.execute(
            select(Segment).where(
                Segment.project_id == proj.id,
                Segment.active == True,  # noqa: E712
                Segment.source == "generated",
                Segment.start_ts < job.end_ts,
                Segment.end_ts > job.start_ts,
            )
        )
    ).scalars().all()
    for s in overlapping:
        s.active = False

    seg = Segment(
        project_id=proj.id,
        start_ts=job.start_ts,
        end_ts=job.end_ts,
        source="generated",
        url=storage.url_for_path(normalized_path),
        variant_id=variant.id,
        order_index=int(job.start_ts * 1000),
        active=True,
    )
    db.add(seg)
    await db.commit()
    await db.refresh(seg)

    # extract the bbox crop from the reference frame for entity identification
    crop_path = None
    if job.bbox_json and job.reference_frame_ts is not None:
        frame_path, _ = storage.new_path("keyframes", "jpg")
        try:
            await ffmpeg.extract_frame(
                proj.video_path, float(job.reference_frame_ts), frame_path
            )
            crop_path = str(frame_path)
        except Exception:
            pass

    # enqueue entity search as its own Job row
    ent_job = Job(
        project_id=proj.id,
        kind="entity",
        status="pending",
        payload={
            "segment_id": seg.id,
            "reference_crop_path": crop_path,
            "reference_variant_url": variant.url,
            "bbox": job.bbox_json,
        },
    )
    db.add(ent_job)
    await db.commit()
    await db.refresh(ent_job)

    runner.submit(ent_job.id, lambda: entity_job.run(ent_job.id))

    return AcceptResponse(segment_id=seg.id, entity_job_id=ent_job.id)
