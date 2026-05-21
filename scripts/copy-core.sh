#!/usr/bin/env bash
# Copy essential core files from magi-next to magi-desktop
set -euo pipefail

SRC="/Users/ktz/magi-next/src"
DST="/Users/ktz/magi-desktop/src/core"

declare -a FILES=(
  # Agent
  "$SRC/agent/query.ts"
  "$SRC/agent/tools.ts"
  "$SRC/agent/system-prompt.ts"

  # Providers
  "$SRC/providers/ir.ts"
  "$SRC/providers/errors.ts"
  "$SRC/providers/http.ts"
  "$SRC/providers/sse.ts"
  "$SRC/providers/openai.ts"
  "$SRC/providers/messages-compatible.ts"
  "$SRC/providers/registry.ts"
  "$SRC/providers/format-proxy.ts"

  # Tools
  "$SRC/tools/errors.ts"
  "$SRC/tools/registry.ts"
  "$SRC/tools/workspace.ts"
  "$SRC/tools/browser.ts"
  "$SRC/tools/web-browser.ts"
  "$SRC/tools/web-fetch.ts"
  "$SRC/tools/web-search.ts"
  "$SRC/tools/files.ts"
  "$SRC/tools/file-copy.ts"
  "$SRC/tools/file-move.ts"
  "$SRC/tools/file-delete.ts"
  "$SRC/tools/dir-create.ts"
  "$SRC/tools/dir-list.ts"
  "$SRC/tools/shell.ts"
  "$SRC/tools/git.ts"
  "$SRC/tools/git-branch-delete.ts"
  "$SRC/tools/git-stash.ts"
  "$SRC/tools/git-reset.ts"
  "$SRC/tools/search.ts"
  "$SRC/tools/file-find.ts"
  "$SRC/tools/head-tail.ts"
  "$SRC/tools/text-stats.ts"
  "$SRC/tools/tree-view.ts"
  "$SRC/tools/lsp.ts"
  "$SRC/tools/config-tool.ts"
  "$SRC/tools/cron.ts"
  "$SRC/tools/monitor.ts"
  "$SRC/tools/sleep.ts"
  "$SRC/tools/process-list.ts"
  "$SRC/tools/kill-process.ts"
  "$SRC/tools/environment.ts"
  "$SRC/tools/disk-usage.ts"
  "$SRC/tools/system-info.ts"
  "$SRC/tools/http-request.ts"
  "$SRC/tools/download-file.ts"
  "$SRC/tools/json-query.ts"
  "$SRC/tools/archive-create.ts"
  "$SRC/tools/archive-extract.ts"
  "$SRC/tools/whoami.ts"
  "$SRC/tools/network-check.ts"
  "$SRC/tools/base64.ts"
  "$SRC/tools/which.ts"
  "$SRC/tools/date.ts"
  "$SRC/tools/snip.ts"
  "$SRC/tools/skill-tool.ts"
  "$SRC/tools/todo.ts"
  "$SRC/tools/tool-search.ts"
  "$SRC/tools/tasks.ts"
  "$SRC/tools/plan-mode.ts"
  "$SRC/tools/worktree.ts"
  "$SRC/tools/github.ts"
  "$SRC/tools/agent-tool.ts"
  "$SRC/tools/notebook.ts"
  "$SRC/tools/user-message.ts"
  "$SRC/tools/user-question.ts"
  "$SRC/tools/workspace-diagnostics.ts"

  # Context
  "$SRC/context/layers.ts"
  "$SRC/context/compaction.ts"
  "$SRC/context/token-budget.ts"

  # Hooks
  "$SRC/hooks/runner.ts"
  "$SRC/hooks/events.ts"

  # MCP (minimal)
  "$SRC/mcp/tool-registry.ts"
  "$SRC/mcp/client.ts"
  "$SRC/mcp/connection-manager.ts"
  "$SRC/mcp/types.ts"

  # SSH
  "$SRC/ssh/exec.ts"
  "$SRC/ssh/file.ts"

  # Skills
  "$SRC/skills/loader.ts"

  # Root files
  "$SRC/config.ts"
  "$SRC/errors.ts"
  "$SRC/paths.ts"
  "$SRC/session-store.ts"
  "$SRC/memory.ts"
  "$SRC/memdir.ts"
  "$SRC/fs-utils.ts"
  "$SRC/env.ts"
  "$SRC/events.ts"
  "$SRC/logger.ts"
  "$SRC/cost.ts"
)

echo "Copying ${#FILES[@]} files..."
for f in "${FILES[@]}"; do
    # Compute destination path: replace $SRC with $DST
    rel="${f#$SRC/}"
    dest="$DST/$rel"
    destdir="$(dirname "$dest")"
    mkdir -p "$destdir"
    cp "$f" "$dest"
done
echo "Copy done."

echo "Fixing .js → .ts in import paths..."
find "$DST" -name "*.ts" -exec sed -i '' "s/\.js'/\.ts'/g" {} \;
find "$DST" -name "*.ts" -exec sed -i '' 's/\.js"/\.ts"/g' {} \;

echo "All done."
