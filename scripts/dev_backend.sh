#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/backend"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q --upgrade pip
pip install -q -r requirements.txt

# load .env from repo root if present
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

case "${USE_AI_STUBS:-true}" in
  0|false|False|FALSE|no|No|NO)
    AI_MODE="real"
    ;;
  *)
    AI_MODE="stub"
    ;;
esac

echo "[dev_backend] ai mode: $AI_MODE"

if [ "$AI_MODE" = "real" ]; then
  if ! python -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('google.genai') else 1)"; then
    echo "[dev_backend] real ai mode needs google-genai installed in backend/.venv"
    echo "[dev_backend] rerun this script after requirements finish installing, or flip USE_AI_STUBS=true for local stub mode"
    exit 1
  fi

  if [ -n "${RUNWAY_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "[dev_backend] RUNWAY_API_KEY is set, but this backend's live video path uses Gemini/Veo via GEMINI_API_KEY"
  fi

  if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "[dev_backend] USE_AI_STUBS=false but GEMINI_API_KEY is missing"
    echo "[dev_backend] set GEMINI_API_KEY for live Gemini/Veo calls, or flip USE_AI_STUBS=true for local stub mode"
    exit 1
  fi

  if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
    echo "[dev_backend] ELEVENLABS_API_KEY is not set; narration requests will fail until you add it"
  fi
else
  if [ -n "${GEMINI_API_KEY:-}" ] || [ -n "${ELEVENLABS_API_KEY:-}" ] || [ -n "${RUNWAY_API_KEY:-}" ]; then
    echo "[dev_backend] provider keys are present, but USE_AI_STUBS is still on so the backend will use stub providers"
  fi
fi

# backend imports both `app.*` (from ./backend) and `ai.*` (from repo root)
export PYTHONPATH="$REPO_ROOT:$REPO_ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"

exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
