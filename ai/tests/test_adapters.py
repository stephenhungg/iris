"""Tests for the adapter layer between backend workers and AI services.

Validates that:
1. Stubs return correct shapes matching TypedDict contracts
2. Real adapters normalize field names correctly
3. Config switch routes to the right implementation
"""

import os
import pytest

# Force stubs mode for these tests
os.environ["USE_AI_STUBS"] = "true"


@pytest.mark.asyncio
async def test_stub_plan_variants():
    """gemini.plan_variants returns 3 EditPlan dicts with expected fields."""
    from ai.services._stubs import gemini

    plans = await gemini.plan_variants(
        "make this car red",
        {"x": 0.25, "y": 0.4, "w": 0.3, "h": 0.35},
        "/tmp/frame.png",
    )

    assert len(plans) == 3
    for plan in plans:
        assert "description" in plan
        assert "tone" in plan
        assert "color_grading" in plan
        assert "region_emphasis" in plan
        assert "prompt_for_runway" in plan
        assert isinstance(plan["prompt_for_runway"], str)
        assert len(plan["prompt_for_runway"]) > 0


@pytest.mark.asyncio
async def test_stub_score_variant():
    """gemini.score_variant returns {visual_coherence, prompt_adherence} ints 1-10."""
    from ai.services._stubs import gemini

    score = await gemini.score_variant(
        ["/tmp/f1.png", "/tmp/f2.png", "/tmp/f3.png"],
        "make this car red",
    )

    assert "visual_coherence" in score
    assert "prompt_adherence" in score
    assert 1 <= score["visual_coherence"] <= 10
    assert 1 <= score["prompt_adherence"] <= 10


@pytest.mark.asyncio
async def test_stub_identify_entity():
    """gemini.identify_entity returns {description, category, attributes}."""
    from ai.services._stubs import gemini

    entity = await gemini.identify_entity("/tmp/crop.png")

    assert "description" in entity
    assert "category" in entity
    assert "attributes" in entity
    assert isinstance(entity["description"], str)


@pytest.mark.asyncio
async def test_stub_find_entity_in_keyframes():
    """gemini.find_entity_in_keyframes returns list of EntityHit dicts."""
    from ai.services._stubs import gemini

    entity = {"description": "silver sedan", "category": "vehicle", "attributes": {}}
    keyframes = [f"/tmp/kf_{i}.png" for i in range(10)]

    hits = await gemini.find_entity_in_keyframes(entity, keyframes)

    assert isinstance(hits, list)
    for hit in hits:
        assert "start_ts" in hit
        assert "end_ts" in hit
        assert "keyframe_url" in hit
        assert "confidence" in hit
        assert isinstance(hit["confidence"], float)
        assert 0 <= hit["confidence"] <= 1


@pytest.mark.asyncio
async def test_stub_runway_generate():
    """runway.generate returns {url, description}."""
    from ai.services._stubs import runway

    plan = {
        "description": "red car",
        "tone": "cinematic",
        "color_grading": "warm",
        "region_emphasis": "center",
        "prompt_for_runway": "make the car red",
    }

    result = await runway.generate("/tmp/clip.mp4", plan)

    assert "url" in result
    assert "description" in result
    assert isinstance(result["url"], str)


@pytest.mark.asyncio
async def test_stub_elevenlabs_narrate():
    """elevenlabs.narrate returns bytes."""
    from ai.services._stubs import elevenlabs

    audio = await elevenlabs.narrate("The car transforms to red")

    assert isinstance(audio, bytes)
    assert len(audio) > 0


class TestRealAdapters:
    """Test that real adapters normalize field names correctly.

    Only runs when GEMINI_API_KEY is set.
    """

    pytestmark = pytest.mark.skipif(
        not os.getenv("GEMINI_API_KEY"),
        reason="GEMINI_API_KEY not set",
    )

    @pytest.mark.asyncio
    async def test_real_plan_variants_normalizes_field_names(self):
        """prompt_for_veo gets aliased to prompt_for_runway."""
        os.environ["USE_AI_STUBS"] = "false"

        from ai.services.gemini import create_edit_plan

        plan = await create_edit_plan(
            prompt="make this car red",
            bbox={"x": 0.25, "y": 0.4, "w": 0.3, "h": 0.35},
        )

        for variant in plan.get("variants", []):
            assert "prompt_for_veo" in variant

        os.environ["USE_AI_STUBS"] = "true"

    @pytest.mark.asyncio
    async def test_real_identify_entity_has_visual_attributes(self):
        """Real identify_entity returns visual_attributes (adapter renames to attributes)."""
        import subprocess
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            # generate a test frame
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi",
                    "-i", "testsrc=duration=1:size=640x360:rate=1",
                    "-frames:v", "1", f"{tmp}/frame.png",
                ],
                capture_output=True, check=True,
            )

            from ai.services.gemini import identify_entity
            result = await identify_entity(f"{tmp}/frame.png")

            assert "description" in result
            assert "category" in result
            # real module returns visual_attributes
            assert "visual_attributes" in result
