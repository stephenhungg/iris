---
name: iris-edit
version: 1.0.0
description: |
  AI video editing agent. Analyzes video content via multi-agent vision,
  then drives the iris CLI to make prompt-driven localized edits.
  Supports region identification, AI generation, entity propagation,
  narration, and export. Use when asked to "edit a video",
  "change something in a video", or "iris edit".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
triggers:
  - edit video
  - iris edit
  - vibe edit
  - change the video
  - make the video
  - video editing
mutating: true
---

# iris Video Editing Agent

## 1. Prerequisites

Before doing anything, verify the environment. Run all three checks:

```bash
which iris
iris auth status --json
echo $GEMINI_API_KEY
```

**If `which iris` fails:** The CLI is not installed. Install it:
```bash
pip install -e /path/to/iris/cli
```

**If `iris auth status` shows `backend_reachable: false`:** The backend is not running or the URL is wrong. Set the correct URL:
```bash
iris auth login --base-url http://localhost:8000
```

**If `GEMINI_API_KEY` is empty:** Analysis will not work. Ask the user to set it:
```bash
export GEMINI_API_KEY="..."
```

Do not proceed until all three checks pass.

---

## 2. Workflow Overview

Follow these steps for any video editing task. Steps marked [ASK] require user confirmation before proceeding.

1. **Upload** the video (or identify an existing project).
2. **Analyze** the video with `iris analyze` to extract scenes, entities, and edit suggestions.
3. **Read the analysis** output. Understand what is in the video, where, and when.
4. **[ASK] Present findings** to the user. Summarize scenes, entities, and suggest edits. Ask which edits the user wants.
5. **For each approved edit:**
   a. Use `iris identify` to confirm the target region.
   b. Use `iris generate` to create AI edit variants.
   c. **[ASK]** Show the variants and quality scores. Ask which to accept.
   d. Use `iris accept` to lock in the chosen variant.
6. **[ASK] Propagate** accepted edits to other appearances of the same entity if applicable.
7. **Optionally** add narration with `iris narrate`.
8. **[ASK] Export** the final video.

---

## 3. Command Reference

All commands output JSON by default. Append `--human` for pretty-printed output. For scripting, use `--json` explicitly.

### 3.1 Auth

**Login / configure:**
```bash
iris auth login --token TOKEN
iris auth login --base-url http://localhost:8000
iris auth login --token TOKEN --base-url http://localhost:8000
```

**Check connection:**
```bash
iris auth status --json
```
Expected output:
```json
{"session_id": "...", "base_url": "...", "token_set": true, "backend_reachable": true}
```
Error: If `backend_reachable` is `false`, the backend is down or the URL is wrong. Re-run `iris auth login --base-url <correct-url>`.

### 3.2 Upload

```bash
iris upload /path/to/video.mp4
```
Expected output:
```json
{"project_id": "proj_abc123", "video_url": "...", "duration": 45.2}
```
Error: File not found -- verify the path exists and is a video file.

### 3.3 Projects

**List all projects:**
```bash
iris projects --json
```
Expected output:
```json
[{"project_id": "proj_abc123", "name": "...", "duration": 45.2, "created_at": "..."}]
```

**Get single project:**
```bash
iris project proj_abc123 --json
```
Expected output:
```json
{"project_id": "proj_abc123", "video_url": "...", "duration": 45.2, "timeline": [...]}
```

### 3.4 Analyze

```bash
iris analyze proj_abc123 --json
iris analyze proj_abc123 --fps 2.0 --chunk-size 4 --no-cache --json
```
Parameters:
- `--fps` (default 1.0): Frames per second to sample. Higher = more detail, slower.
- `--chunk-size` (default 8): Frames per analysis chunk.
- `--max-concurrent` (default 5): Max parallel Gemini calls.
- `--no-cache`: Force re-analysis, ignore cached results.

Expected output:
```json
{
  "duration": 45.2,
  "overall_description": "A short film showing...",
  "scenes": [
    {"start_ts": 0.0, "end_ts": 12.5, "description": "...", "entities": [...]}
  ],
  "entities": [
    {"entity_id": "ent_1", "label": "person in red jacket", "appearances": [
      {"start_ts": 0.0, "end_ts": 8.0, "bbox_hint": {"x": 0.3, "y": 0.2, "w": 0.4, "h": 0.6}}
    ]}
  ],
  "suggested_edits": [
    {"start_ts": 2.0, "end_ts": 5.0, "suggestion": "...", "rationale": "...", "bbox_hint": {"x": 0.3, "y": 0.2, "w": 0.4, "h": 0.6}}
  ]
}
```
Requires `GEMINI_API_KEY` env var. Error: If the key is missing, the command exits with an error message.

### 3.5 Identify

```bash
iris identify --project proj_abc123 --frame 3.5 --bbox "0.3,0.2,0.4,0.6" --json
```
Parameters:
- `--project` / `-p`: Project ID.
- `--frame` / `-f`: Timestamp in seconds.
- `--bbox` / `-b`: Normalized bounding box as `"x,y,w,h"` (values 0-1).

Expected output:
```json
{"entity_id": "ent_1", "label": "person in red jacket", "confidence": 0.92}
```

### 3.6 Mask

```bash
iris mask --project proj_abc123 --frame 3.5 --bbox "0.3,0.2,0.4,0.6" --json
```
Parameters: Same as `identify`.

Expected output:
```json
{"mask_url": "https://...", "area_fraction": 0.15}
```

### 3.7 Generate

```bash
iris generate \
  --project proj_abc123 \
  --start 2.0 \
  --end 5.0 \
  --bbox "0.3,0.2,0.4,0.6" \
  --prompt "Change the red jacket to a blue denim jacket" \
  --json
```
Parameters:
- `--project` / `-p`: Project ID.
- `--start` / `-s`: Start timestamp in seconds.
- `--end` / `-e`: End timestamp in seconds. Segment must be 2-5 seconds.
- `--bbox` / `-b`: Normalized bounding box `"x,y,w,h"`.
- `--prompt`: Natural language description of the edit.
- `--ref-frame`: Reference frame timestamp (defaults to start).
- `--no-wait`: Return immediately without polling for completion.

Expected output (after polling):
```json
{
  "job_id": "job_xyz",
  "status": "completed",
  "variants": [
    {"variant_id": "var_0", "url": "https://...", "quality_score": 0.87},
    {"variant_id": "var_1", "url": "https://...", "quality_score": 0.72}
  ]
}
```
Errors:
- Segment too short or too long: Backend rejects segments outside 2-5 seconds. Adjust `--start` and `--end`.
- Generation failed: Retry once. If it fails again, try a different prompt or bbox.

### 3.8 Job Status

```bash
iris job job_xyz --json
```
Expected output:
```json
{"job_id": "job_xyz", "status": "completed", "variants": [...]}
```
Statuses: `pending`, `processing`, `completed`, `failed`.

### 3.9 Accept

```bash
iris accept --job job_xyz --variant 0
```
Parameters:
- `--job` / `-j`: Job ID from a completed generation.
- `--variant` / `-v`: Variant index to accept (default 0).

Expected output:
```json
{"accepted": true, "variant_id": "var_0", "applied_to_timeline": true}
```

### 3.10 Entity

```bash
iris entity ent_1 --json
```
Expected output:
```json
{
  "entity_id": "ent_1",
  "label": "person in red jacket",
  "appearances": [
    {"start_ts": 0.0, "end_ts": 8.0, "bbox": {"x": 0.3, "y": 0.2, "w": 0.4, "h": 0.6}},
    {"start_ts": 22.0, "end_ts": 30.0, "bbox": {"x": 0.5, "y": 0.1, "w": 0.3, "h": 0.7}}
  ]
}
```

### 3.11 Propagate

```bash
iris propagate \
  --entity ent_1 \
  --source-url "https://...variant_url..." \
  --prompt "Apply the blue denim jacket to all appearances" \
  --json
```
Parameters:
- `--entity` / `-e`: Entity ID.
- `--source-url` / `-s`: URL of the accepted variant to use as the visual source.
- `--prompt`: Describes what to propagate.
- `--no-auto-apply`: Generate variants without auto-applying to the timeline.
- `--no-wait`: Return immediately.

Expected output:
```json
{
  "propagation_job_id": "prop_abc",
  "status": "completed",
  "appearances_edited": 3,
  "results": [...]
}
```

### 3.12 Timeline

```bash
iris timeline proj_abc123 --json
```
Expected output:
```json
{
  "project_id": "proj_abc123",
  "segments": [
    {"start_ts": 0.0, "end_ts": 5.0, "source": "original"},
    {"start_ts": 2.0, "end_ts": 5.0, "source": "variant", "variant_id": "var_0"}
  ]
}
```

### 3.13 Narrate

```bash
iris narrate --variant var_0 --description "The jacket transforms into blue denim"
```
Parameters:
- `--variant` / `-v`: Variant ID.
- `--description` / `-d`: Custom narration text. If omitted, auto-generates from the variant context.

Expected output:
```json
{"narration_url": "https://...", "duration": 3.2}
```

### 3.14 Export

```bash
iris export proj_abc123 --json
```
Parameters:
- `--no-wait`: Return immediately without polling.

Expected output:
```json
{"export_job_id": "exp_abc", "status": "completed", "download_url": "https://..."}
```

---

## 4. Decision Gates

At these points, STOP and ask the user before continuing. Never skip these.

### After analysis
Present a summary of what was found:
- Number of scenes and their descriptions
- Entities detected with timestamps
- Suggested edits from the analysis

Then ask: "Here is what I found in your video. Which edits would you like to make?"

### After variant generation
Show the user:
- Number of variants generated
- Quality scores for each
- URLs or descriptions of the variants

Then ask: "Here are the generated variants. Which one would you like to accept?"

### Before propagation
Explain:
- The entity being propagated
- How many other appearances will be affected
- What the edit will look like

Then ask: "This will apply the edit to N other appearances of [entity]. Proceed?"

### Before export
Confirm the timeline looks correct:
- Show `iris timeline` output
- List all edits applied

Then ask: "Ready to export the final video?"

---

## 5. Editing Strategies

### Picking bbox coordinates
- Use `bbox_hint` values from the analysis output when available. These are pre-computed regions of interest.
- BBox format is `"x,y,w,h"` where all values are normalized 0-1.
  - `x,y` = top-left corner of the box.
  - `w,h` = width and height of the box.
- If no hint exists, use `iris identify` with an approximate bbox to verify you have the right region before generating.

### Choosing segment boundaries
- Segments MUST be 2-5 seconds. The backend rejects anything outside this range.
- Prefer natural scene boundaries from the analysis output (`scenes[].start_ts`, `scenes[].end_ts`).
- If a scene is longer than 5 seconds, split it into overlapping 4-second segments.
- Avoid cutting mid-action. Look for pauses or transitions.

### Writing good prompts
- Be specific: "Change the red jacket to a blue denim jacket" not "change the clothing."
- Reference the identified entity: "Make the person in the red jacket wear a blue denim jacket."
- Describe the desired outcome, not the process.
- Keep prompts under 200 characters for best results.

### Propagation vs. individual edits
- Use **propagation** when the same entity appears multiple times and you want a consistent edit across all appearances (e.g., changing a character's outfit throughout).
- Use **individual edits** when each appearance needs a different treatment, or when entities only appear once.
- Propagation uses the accepted variant as the visual source, so always accept the best variant first.

---

## 6. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `backend_reachable: false` | Backend not running or wrong URL | Start the backend. Run `iris auth login --base-url <url>`. |
| `GEMINI_API_KEY required` | Env var not set | `export GEMINI_API_KEY="..."` |
| Segment length error | `end - start` outside 2-5s range | Adjust `--start` and `--end` to a 2-5s window. |
| Generation job `failed` | Model error or bad prompt | Check `iris job JOB_ID --json` for error details. Retry with a simpler prompt. |
| Upload fails | File too large or unsupported format | Videos must be under 120 seconds. Use mp4, mov, or webm. |
| Polling timeout | Job taking too long | Use `--no-wait`, then check manually with `iris job JOB_ID`. |
| `identify` returns low confidence | Bad bbox or wrong frame | Try a different frame timestamp or widen the bbox. |
| Propagation partial failure | Some appearances too different | Check results, then generate individual edits for failed appearances. |

### Retry logic
If a `generate` or `propagate` command fails:
1. Check the job status with `iris job JOB_ID --json` for error details.
2. Retry once with the same parameters.
3. If it fails again, try adjusting: simplify the prompt, tweak the bbox, or shift the time range.
4. Report the failure to the user with the error details.

---

## 7. Portability

This skill file works with any agent that can execute bash commands and interact with users:
- **Claude Code:** Place this file at `cli/SKILL.md`. It will be discovered automatically via the `triggers` frontmatter.
- **OpenClaw, Codex, Cursor, or other agents:** Paste the full content of this file into the system prompt. The agent needs `Bash` access and the ability to ask the user questions at decision gates.
- **CI/CD or scripts:** The iris CLI is fully scriptable. Strip the decision gates and use `--json` output with `--no-wait` for async workflows. Poll with `iris job JOB_ID --json` until status is `completed`.

The only runtime dependencies are:
- Python 3.10+ with the `iris-cli` package installed.
- A running iris backend at the configured `base_url`.
- `GEMINI_API_KEY` for the `analyze` command.
