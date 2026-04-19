"""HTTP client wrapping the iris FastAPI backend."""

from pathlib import Path
from typing import Any

import httpx


class IrisClient:
    """Synchronous wrapper around the iris API."""

    def __init__(
        self,
        base_url: str,
        session_id: str,
        token: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.session_id = session_id
        self.token = token

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"X-Session-Id": self.session_id}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api{path}"

    def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> Any:
        with httpx.Client(timeout=120.0) as client:
            response = client.request(
                method,
                self._url(path),
                headers=self._headers(),
                **kwargs,
            )
            response.raise_for_status()
            return response.json()

    # ── Upload ──────────────────────────────────────────────────────────

    def upload(self, file_path: Path) -> dict[str, Any]:
        """POST /api/upload — multipart file upload."""
        with file_path.open("rb") as f:
            return self._request(
                "POST",
                "/upload",
                files={"file": (file_path.name, f, "video/mp4")},
            )

    # ── Projects ────────────────────────────────────────────────────────

    def list_projects(self) -> list[dict[str, Any]]:
        """GET /api/projects — list all projects."""
        return self._request("GET", "/projects")

    def get_project(self, project_id: str) -> dict[str, Any]:
        """GET /api/projects/{id} — project detail."""
        return self._request("GET", f"/projects/{project_id}")

    # ── Generate ────────────────────────────────────────────────────────

    def generate(
        self,
        project_id: str,
        start_ts: float,
        end_ts: float,
        bbox: dict[str, float],
        prompt: str,
        reference_frame_ts: float | None = None,
    ) -> dict[str, Any]:
        """POST /api/generate — start a generation job."""
        body: dict[str, Any] = {
            "project_id": project_id,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "bbox": bbox,
            "prompt": prompt,
        }
        if reference_frame_ts is not None:
            body["reference_frame_ts"] = reference_frame_ts
        return self._request("POST", "/generate", json=body)

    # ── Jobs ────────────────────────────────────────────────────────────

    def get_job(self, job_id: str) -> dict[str, Any]:
        """GET /api/jobs/{id} — job status and variants."""
        return self._request("GET", f"/jobs/{job_id}")

    # ── Accept ──────────────────────────────────────────────────────────

    def accept(self, job_id: str, variant_index: int = 0) -> dict[str, Any]:
        """POST /api/accept — accept a variant."""
        return self._request(
            "POST",
            "/accept",
            json={"job_id": job_id, "variant_index": variant_index},
        )

    # ── Identify ────────────────────────────────────────────────────────

    def identify(
        self,
        project_id: str,
        frame_ts: float,
        bbox: dict[str, float],
    ) -> dict[str, Any]:
        """POST /api/identify — identify an entity in a region."""
        return self._request(
            "POST",
            "/identify",
            json={
                "project_id": project_id,
                "frame_ts": frame_ts,
                "bbox": bbox,
            },
        )

    # ── Mask ────────────────────────────────────────────────────────────

    def mask(
        self,
        project_id: str,
        frame_ts: float,
        bbox: dict[str, float],
    ) -> dict[str, Any]:
        """POST /api/mask — get SAM segmentation mask."""
        return self._request(
            "POST",
            "/mask",
            json={
                "project_id": project_id,
                "frame_ts": frame_ts,
                "bbox": bbox,
            },
        )

    # ── Entities ────────────────────────────────────────────────────────

    def get_entity(self, entity_id: str) -> dict[str, Any]:
        """GET /api/entities/{id} — entity detail + appearances."""
        return self._request("GET", f"/entities/{entity_id}")

    # ── Propagate ───────────────────────────────────────────────────────

    def propagate(
        self,
        entity_id: str,
        source_variant_url: str,
        prompt: str,
        auto_apply: bool = True,
    ) -> dict[str, Any]:
        """POST /api/propagate — start propagation job."""
        return self._request(
            "POST",
            "/propagate",
            json={
                "entity_id": entity_id,
                "source_variant_url": source_variant_url,
                "prompt": prompt,
                "auto_apply": auto_apply,
            },
        )

    def get_propagation(self, propagation_job_id: str) -> dict[str, Any]:
        """GET /api/propagate/{id} — propagation job status."""
        return self._request("GET", f"/propagate/{propagation_job_id}")

    def apply_propagation(
        self,
        propagation_job_id: str,
        result_id: str,
    ) -> dict[str, Any]:
        """POST /api/propagate/{id}/apply/{result_id} — apply a propagation result."""
        return self._request(
            "POST",
            f"/propagate/{propagation_job_id}/apply/{result_id}",
        )

    # ── Timeline ────────────────────────────────────────────────────────

    def get_timeline(self, project_id: str) -> dict[str, Any]:
        """GET /api/timeline/{id} — ordered timeline segments."""
        return self._request("GET", f"/timeline/{project_id}")

    # ── Narrate ─────────────────────────────────────────────────────────

    def narrate(
        self,
        variant_id: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        """POST /api/narrate — generate narration audio."""
        body: dict[str, Any] = {"variant_id": variant_id}
        if description is not None:
            body["description"] = description
        return self._request("POST", "/narrate", json=body)

    # ── Export ──────────────────────────────────────────────────────────

    def export_video(self, project_id: str) -> dict[str, Any]:
        """POST /api/export — start export job."""
        return self._request(
            "POST",
            "/export",
            json={"project_id": project_id},
        )

    def get_export(self, export_job_id: str) -> dict[str, Any]:
        """GET /api/export/{id} — export job status."""
        return self._request("GET", f"/export/{export_job_id}")

    # ── Health ──────────────────────────────────────────────────────────

    def health(self) -> dict[str, Any]:
        """GET /api/health — backend health check."""
        return self._request("GET", "/health")
