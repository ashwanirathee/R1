#!/bin/bash
# Usage: ./run_chroma.sh [--host 127.0.0.1] [--port 8000] [--path ./data/chroma]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="127.0.0.1"
PORT="8000"
CHROMA_PATH="./data/chroma"

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
		--path)
			CHROMA_PATH="$2"
			shift 2
			;;
		*)
			echo "Unknown argument: $1"
			exit 1
			;;
	esac
done

cd "$SCRIPT_DIR"
mkdir -p "$CHROMA_PATH"
uv run chroma run --host "$HOST" --port "$PORT" --path "$CHROMA_PATH"
