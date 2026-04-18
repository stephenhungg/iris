from typing import Literal

from pydantic import BaseModel

from app.schemas.common import JobStatus


class ExportRequest(BaseModel):
    project_id: str
    format: Literal["mp4"] = "mp4"


class ExportResponse(BaseModel):
    export_job_id: str


class ExportStatus(BaseModel):
    export_job_id: str
    status: JobStatus
    export_url: str | None = None
    error: str | None = None
