#!/bin/bash
# Upload circuit artifacts to Cloudflare R2 bucket
# Usage: bash scripts/upload-circuits-r2.sh

set -e

BUCKET="${R2_BUCKET:-utxopia-circuits}"
SRC_DIR="public/circuits/groth16"
# v2 is the only prefix the app reads; v1 is frozen and must not be written to.
R2_PREFIX="circuits/v2/groth16"
# Overridable, but defaults to the account this project's R2 bucket lives in.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-fb5def0d0fb624cb76bddca682c8bfaa}"

if [ ! -d "$SRC_DIR" ]; then
  echo "Error: $SRC_DIR not found. Run from utxopia-app directory."
  exit 1
fi

# Count total files
TOTAL=$(find "$SRC_DIR" -type f | wc -l | tr -d ' ')
COUNT=0

echo "Uploading $TOTAL files from $SRC_DIR to R2 bucket '$BUCKET'..."

find "$SRC_DIR" -type f | while read -r file; do
  # R2 key = "circuits/v2/groth16/..." (re-root the local public/ path onto v2)
  key="$R2_PREFIX/${file#$SRC_DIR/}"

  # Determine content-type
  case "$file" in
    *.wasm) ct="application/wasm" ;;
    *.zkey) ct="application/octet-stream" ;;
    *.json) ct="application/json" ;;
    *.js)   ct="application/javascript" ;;
    *)      ct="application/octet-stream" ;;
  esac

  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL] $key ($ct)"
  wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type "$ct" --remote 2>/dev/null
done

echo "Done! All $TOTAL files uploaded."
echo "Base URL: https://circuit.utxopia.com/$R2_PREFIX"
