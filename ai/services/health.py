"""Health + observability endpoint for AI services.

Mount this router in the backend to expose /api/ai/health and /api/ai/timeline.
Person 2 can add: app.include_router(ai_health_router, prefix="/api/ai")
"""

from fastapi import APIRouter

from ai.services.logger import get_stats, get_timeline
from ai.services.sam import is_available as gpu_available

router = APIRouter(tags=["ai-observability"])


@router.get("/health")
async def ai_health():
    """Full observability dashboard for AI services.

    Returns:
        - uptime, total calls, total errors, total estimated cost
        - per-service breakdown: calls, errors, error rate, latency stats
        - GPU worker availability
    """
    stats = get_stats()
    stats["gpu_worker_available"] = await gpu_available()
    return stats


@router.get("/timeline")
async def ai_timeline(last_n: int = 50):
    """Last N AI service calls with timing and status.

    Useful for debugging during a live demo — see exactly what's
    happening in the pipeline and where time is being spent.
    """
    return {"events": get_timeline(last_n)}
