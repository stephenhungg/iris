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

# backend imports both `app.*` (from ./backend) and `ai.*` (from repo root)
export PYTHONPATH="$REPO_ROOT:$REPO_ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"

exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
