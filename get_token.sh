#!/usr/bin/env bash
set -euo pipefail

# Load .env if present
ENV_FILE="$(dirname "$0")/api/.env"
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

API_BASE="${API_BASE:-http://localhost:8000}"
USERNAME="${ADMIN_USERNAME:-admin}"
PASSWORD="${ADMIN_PASSWORD:-change-me}"

response=$(curl -sf -X POST "${API_BASE}/api/auth/token" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${USERNAME}\", \"password\": \"${PASSWORD}\"}")

token=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "$token"
