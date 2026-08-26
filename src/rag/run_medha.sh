#!/bin/bash
# Usage: ./run_medha.sh [--host 0.0.0.0] [--port 8051]
# Defaults: --host 0.0.0.0 --port 8051

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="0.0.0.0"
PORT="8051"

# Parse args for --host and --port, allow override
while [[ $# -gt 0 ]]; do
	case $1 in
		--host)
			HOST="$2"
			shift 2
			;;
		--port)
			PORT="$2"
			shift 2
			;;
		*)
			echo "Unknown argument: $1"
			exit 1
			;;
	esac
done

cd "$SCRIPT_DIR"
MEDHA_BUILD_ON_START=true uv run python -m uvicorn run_medha:app --host "$HOST" --port "$PORT" --reload
