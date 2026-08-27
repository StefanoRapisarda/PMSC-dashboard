#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -f pmsc.db ] || .venv/bin/python -m app.seed
exec .venv/bin/uvicorn app.main:app --reload --port "${PORT:-8000}"
