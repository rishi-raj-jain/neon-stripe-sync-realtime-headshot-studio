#!/usr/bin/env bash
# Replay a storage_object_created delivery against `neon dev` (functions/onupload.ts).
#
#   npx neon dev                                  # terminal 1, serves onupload on :8787
#   scripts/replay-upload.sh uploads/<userId>/<jobId>.jpg   # terminal 2
#
# The object must exist in the `selfies` bucket of the branch your .env points at, and the
# job must be `awaiting_upload` (reset it with the SQL in docs/debugging.md to re-run).
set -euo pipefail

KEY="${1:?usage: replay-upload.sh <object_key> [port]}"
PORT="${2:-8787}"
ID="replay-$(date +%s)"

curl -sS -X POST "http://localhost:${PORT}/" \
  -H "content-type: application/json" \
  -H "x-neon-trigger-invocation-id: ${ID}" \
  -d @- <<JSON
{
  "version": 1,
  "invocation_id": "${ID}",
  "trigger": { "type": "storage_object_created", "id": "local-replay", "name": "selfie-uploaded" },
  "data": { "bucket_name": "selfies", "object_key": "${KEY}" }
}
JSON
echo
