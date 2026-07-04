#!/usr/bin/env bash
# Record an infrawise demo session.
#
# Usage:
#   bash docs/demo/record.sh <name>
#   pnpm record:live <name>
#
# The session is saved to docs/demo/gifs/<name>.gif
# Re-run with the same name to overwrite.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GIFS_DIR="$REPO_ROOT/docs/demo/gifs"
CASTS_DIR="$REPO_ROOT/docs/demo/casts"

mkdir -p "$GIFS_DIR" "$CASTS_DIR"

for cmd in asciinema agg; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "error: $cmd not found — brew install $cmd"
    exit 1
  fi
done

NAME="${1:-demo}"
CAST="$CASTS_DIR/$NAME.cast"
GIF="$GIFS_DIR/$NAME.gif"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo recorder — $NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Session flow:"
echo "    1. npx infrawise start --claude"
echo "    2. Answer setup questions"
echo "    3. Claude opens → ask your question"
echo "    4. Exit Claude (type /exit or Ctrl-C)"
echo ""
echo "  Press Enter to start recording, Ctrl-D when done."
echo ""
read -r  # wait here — recording has NOT started yet

clear    # clean slate before asciinema starts

asciinema rec "$CAST" --overwrite --window-size 220x50

echo ""
echo "  Converting to GIF..."

agg "$CAST" "$GIF" \
  --font-size 16 \
  --theme monokai \
  --idle-time-limit 3 \
  --last-frame-duration 8

echo "  ✓ $GIF"
echo ""
