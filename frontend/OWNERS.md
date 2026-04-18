# Frontend — Person 1

Everything in this folder is yours. React + Vite + TypeScript.

## What you own
- Video player with frame-accurate scrubbing
- Timeline with segment selection (2-5s, no overlaps, snap to boundaries)
- Canvas overlay for drawing bounding boxes (top-left origin, normalized 0-1)
- Prompt bar (text input + generate button)
- Variant shelf (3 cards, progressive reveal as each completes)
- Before/after wipe slider (the hero demo moment)
- Continuity pack UI (entity propagation panel)
- Entity tracker display
- Job status indicators / loading states
- All state management (stores/)
- API client (api/) — calls backend endpoints, see types/ for contracts

## Key interactions
- You consume the API defined in `types/` — backend (Person 2) serves it
- Variants arrive progressively (poll /api/jobs/{id}), not all at once
- Narration audio from ElevenLabs comes via /api/narrate (Person 3 builds the service)
- bbox coords: top-left origin, normalized 0-1, converted client-side before POST

## Don't touch
- `backend/`, `ai/`, `infra/`
