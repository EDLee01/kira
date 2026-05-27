import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildLayeredContext } from "../src/core/context/layers.ts";
import { writeMemoryFile } from "../src/core/memory-files.ts";
import { appendMemory, extractExplicitMemoryWrite } from "../src/core/memory.ts";
import { proposeMemoryDraft, listDrafts, showDraft } from "../src/core/memory-draft.ts";
import { selectRelevantMemories } from "../src/core/memory-selection.ts";
import { writeMemdirEntry } from "../src/core/memdir.ts";
import { ProviderAdapter, ProviderRequest, ProviderResponse } from "../src/core/providers/ir.ts";
import { MagiPaths } from "../src/core/paths.ts";

class SelectionAdapter implements ProviderAdapter {
  readonly name = "selection-test";
  request: ProviderRequest | undefined;

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.request = request;
    return { text: "[1]" };
  }
}

function makePaths(root: string): MagiPaths {
  const stateRoot = path.join(root, "state");
  return {
    root,
    configFile: path.join(root, "config.yaml"),
    stateRoot,
    sessionsRoot: path.join(root, "sessions"),
    logsRoot: path.join(root, "logs"),
    cacheRoot: path.join(root, "cache"),
    pluginsRoot: path.join(root, "plugins"),
    skillsRoot: path.join(root, "skills"),
    devicesRoot: path.join(root, "devices"),
    sessionDbFile: path.join(stateRoot, "sessions.sqlite")
  };
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), "kira-memory-alignment-"));
  try {
    const paths = makePaths(root);

    writeMemoryFile({
      appRoot: paths.root,
      filePath: "projects/kira.md",
      content: "# Project: Kira\n\nKira memory system uses LLM-Wiki pages."
    });
    writeMemdirEntry({
      paths,
      type: "project",
      name: "Kira memory",
      description: "Kira aligns memory with LLM-Wiki pages",
      body: "Use wiki pages as source of truth and drafts for review."
    });

    const layered = buildLayeredContext({
      cwd: root,
      paths,
      systemInstructions: "system",
      includeGit: false,
      includeDate: false
    });
    assert.match(layered.systemPrompt, /projects\/kira\.md/);
    assert.match(layered.systemPrompt, /Kira memory/);

    appendMemory({ paths, cwd: root, scope: "user", text: "prefers concise Chinese answers" });
    appendMemory({ paths, cwd: root, scope: "user", text: "Kira should keep memory as LLM-Wiki" });
    const selector = new SelectionAdapter();
    const selected = await selectRelevantMemories({
      paths,
      cwd: root,
      sessionId: "session-1",
      scopes: ["user"],
      maxResults: 1,
      prompt: "Kira memory wiki",
      selectionRoute: {
        adapter: selector,
        model: "fast-selection",
        providerName: "test"
      }
    });
    assert.equal(selected.method, "llm");
    assert.equal(selected.entries.length, 1);
    assert.match(selected.entries[0].text, /LLM-Wiki/);
    assert.equal(selector.request?.model, "fast-selection");

    const explicit = extractExplicitMemoryWrite("记住项目记忆：Kira 的长期记忆主干是 LLM-Wiki");
    assert.deepEqual(explicit, {
      scope: "project",
      text: "Kira 的长期记忆主干是 LLM-Wiki"
    });
    const draft = proposeMemoryDraft({
      appRoot: paths.root,
      targetFile: "projects/default.md",
      content: `## Project memory\n\n${explicit.text}`,
      reason: `Explicit user Memory request for ${explicit.scope}`,
      sourceSession: "session-1",
      confidence: 1
    });
    const drafts = listDrafts({ appRoot: paths.root });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].id, draft.id);
    assert.equal(drafts[0].status, "pending");
    assert.match(showDraft({ appRoot: paths.root, id: draft.id }).content, /LLM-Wiki/);

    const auditFile = path.join(paths.root, "memory", "logs", "audit.jsonl");
    assert.equal(existsSync(auditFile), true);
    assert.match(readFileSync(auditFile, "utf8"), /memory\.draft\.proposed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
