/**
 * LLM-assisted selection for legacy line-based Memory entries.
 * The LLM route is optional; keyword search remains the deterministic fallback.
 */

import { ProviderAdapter, ProviderRequest, textMessage } from "./providers/ir.ts";
import { MemoryEntry, MemorySearchResult, listMemoryEntries, searchMemory, formatMemorySearchResults } from "./memory.ts";
import { MagiPaths } from "./paths.ts";
import { MemoryScope } from "./memory.ts";

export interface MemorySelectionRoute {
  adapter: ProviderAdapter;
  model: string;
  providerName: string;
}

export interface SelectMemoryInput {
  paths: MagiPaths;
  cwd: string;
  sessionId?: string;
  scopes?: MemoryScope[];
  maxResults: number;
  prompt: string;
  selectionRoute?: MemorySelectionRoute;
  signal?: AbortSignal;
}

export interface SelectMemoryResult {
  entries: MemorySearchResult[];
  method: "keyword" | "llm";
  formatted: string | undefined;
}

export async function selectRelevantMemories(input: SelectMemoryInput): Promise<SelectMemoryResult> {
  const allEntries = listMemoryEntries({
    paths: input.paths,
    cwd: input.cwd,
    sessionId: input.sessionId,
    scopes: input.scopes
  });

  if (allEntries.length === 0) {
    return { entries: [], method: "keyword", formatted: undefined };
  }

  if (!input.selectionRoute || allEntries.length <= input.maxResults) {
    return keywordSelect(input);
  }

  try {
    const selected = await llmSelectMemories({
      entries: allEntries,
      prompt: input.prompt,
      maxResults: input.maxResults,
      route: input.selectionRoute,
      signal: input.signal
    });
    const formatted = selected.length > 0 ? formatMemorySearchResults(selected) : undefined;
    return { entries: selected, method: "llm", formatted };
  } catch {
    return keywordSelect(input);
  }
}

function keywordSelect(input: SelectMemoryInput): SelectMemoryResult {
  const results = searchMemory({
    paths: input.paths,
    cwd: input.cwd,
    sessionId: input.sessionId,
    scopes: input.scopes,
    maxResults: input.maxResults,
    query: input.prompt
  });
  return {
    entries: results,
    method: "keyword",
    formatted: results.length > 0 ? formatMemorySearchResults(results) : undefined
  };
}

async function llmSelectMemories(input: {
  entries: MemoryEntry[];
  prompt: string;
  maxResults: number;
  route: MemorySelectionRoute;
  signal?: AbortSignal;
}): Promise<MemorySearchResult[]> {
  const numbered = input.entries.map((entry, i) => `[${i}] (${entry.scope}) ${entry.text}`);
  const selectionPrompt = [
    `Given the user's current prompt, select up to ${input.maxResults} most relevant memory entries.`,
    "Return ONLY a JSON array of indices, e.g. [0, 3, 7]. No explanation.",
    "",
    `User prompt: ${input.prompt.slice(0, 2000)}`,
    "",
    "Available memories:",
    ...numbered
  ].join("\n");

  const request: ProviderRequest = {
    model: input.route.model,
    messages: [textMessage("user", selectionPrompt)],
    temperature: 0,
    maxOutputTokens: 256,
    signal: input.signal
  };

  const response = await input.route.adapter.complete(request);
  const indices = parseIndices(response.text, input.entries.length);

  return indices
    .slice(0, input.maxResults)
    .map((index) => ({
      ...input.entries[index],
      score: input.maxResults - indices.indexOf(index)
    }));
}

function parseIndices(text: string, maxIndex: number): number[] {
  const match = /\[[\d\s,]*\]/.exec(text);
  if (!match) {
    return [];
  }
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 && value < maxIndex
    );
  } catch {
    return [];
  }
}
