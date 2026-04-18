"""Structured logging + timing for all AI services.

Every service call gets logged with: service name, operation, duration, success/error,
and cost estimate (API calls add up fast at a hackathon).
"""

import time
import logging
import functools
from typing import Any, Callable

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger("iris.ai")

# rough cost estimates per API call (for tracking burn rate)
COST_ESTIMATES = {
    "gemini:edit_plan": 0.01,
    "gemini:identify_entity": 0.005,
    "gemini:search_keyframes": 0.005,
    "gemini:score_variant": 0.005,
    "gemini:narration_script": 0.002,
    "veo:generate_variant": 0.05,
    "elevenlabs:narrate": 0.01,
    "gpu:sam_segment": 0.0,  # self-hosted
    "gpu:clip_embed": 0.0,
    "gpu:clip_batch": 0.0,
}

_total_cost = 0.0
_call_counts: dict[str, int] = {}


def tracked(service: str, operation: str):
    """Decorator that logs timing, errors, and estimated cost for a service call."""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            global _total_cost
            key = f"{service}:{operation}"
            _call_counts[key] = _call_counts.get(key, 0) + 1

            logger.info(f"[{key}] starting (call #{_call_counts[key]})")
            start = time.monotonic()

            try:
                result = await func(*args, **kwargs)
                elapsed = time.monotonic() - start
                cost = COST_ESTIMATES.get(key, 0.0)
                _total_cost += cost

                logger.info(
                    f"[{key}] done in {elapsed:.2f}s "
                    f"(est. ${cost:.3f}, total ${_total_cost:.3f})"
                )
                return result

            except Exception as e:
                elapsed = time.monotonic() - start
                logger.error(f"[{key}] failed after {elapsed:.2f}s: {e}")
                raise

        return wrapper
    return decorator


def get_stats() -> dict:
    """Return current session stats for the /health endpoint."""
    return {
        "total_estimated_cost": round(_total_cost, 4),
        "call_counts": dict(_call_counts),
    }
