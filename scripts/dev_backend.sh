#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../backend"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q --upgrade pip
pip install -q -r requirements.txt

# load .env from repo root if present
if [ -f ../.env ]; then
  set -a
  # shellcheck disable=SC1091
  source ../.env
  set +a
fi

exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
