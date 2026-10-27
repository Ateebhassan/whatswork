#!/bin/sh
# Bundles the shared planner + calendar logic into core.mjs, which the background worker imports.
# Run after editing planner-core.js or ww-core.js, push, then point the worker's import at the new commit
# (https://cdn.jsdelivr.net/gh/Ateebhassan/whatswork@<commit>/core.mjs) and redeploy it.
cd "$(dirname "$0")"
{ echo "// Generated from planner-core.js and ww-core.js by build-worker-core.sh. Edit those files, not this one."
  cat planner-core.js ww-core.js
  echo "export { WWCore, normaliseState };"; } > core.mjs
