#!/usr/bin/env bash
# CleanCore Defect Hub - Linux/macOS launcher. Usage: ./deploy/start.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo ".env.local not found - copy .env.example to .env.local and fill it in"; exit 1; }
[ -d .next ] || { npm ci && npm run build; }
exec npm run start
