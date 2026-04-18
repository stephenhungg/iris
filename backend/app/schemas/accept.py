from pydantic import BaseModel


class AcceptRequest(BaseModel):
    job_id: str
    variant_index: int


class AcceptResponse(BaseModel):
    segment_id: str
    entity_job_id: str | None = None
