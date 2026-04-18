"""ai/services — AI pipeline.

Person 3 owns real implementations. Until those exist, the backend imports
from _stubs.py via the facade below when settings.use_ai_stubs is True.
"""
from app.config.settings import get_settings
from ai.services import _stubs

_settings = get_settings()

if _settings.use_ai_stubs:
    gemini = _stubs.gemini
    runway = _stubs.runway
    elevenlabs = _stubs.elevenlabs
    entity_tracker = _stubs.entity_tracker
else:
    # real modules land here when Person 3 ships them
    from ai.services import gemini as _gemini  # type: ignore
    from ai.services import runway as _runway  # type: ignore
    from ai.services import elevenlabs as _elevenlabs  # type: ignore
    from ai.services import entity_tracker as _entity_tracker  # type: ignore

    gemini = _gemini
    runway = _runway
    elevenlabs = _elevenlabs
    entity_tracker = _entity_tracker
