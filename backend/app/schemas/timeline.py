from pydantic import BaseModel

from app.schemas.common import SegmentSource


class TimelineSegment(BaseModel):
    start_ts: float
    end_ts: float
    source: SegmentSource
    url: str
    audio: bool


class TimelineOut(BaseModel):
    project_id: str
    duration: float
    segments: list[TimelineSegment]
