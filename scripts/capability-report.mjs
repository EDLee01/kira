#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportsRoot = path.join(repoRoot, ".kira-reports");
const outputPath =
  process.env.KIRA_CAPABILITY_REPORT ??
  path.join(reportsRoot, "capability-alignment-report.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  {
    id: "workspace-policy",
    title: "Workspace policy and runtime isolation",
    script: "test:workspace",
    capabilities: ["workspace-boundary", "runtime-env", "safe-shell"]
  },
  {
    id: "agent-harness",
    title: "Agent provider, routing, and refusal recovery",
    script: "test:agent-alignment",
    capabilities: ["model-routing", "provider-compat", "tool-input-compat", "refusal-retry"]
  },
  {
    id: "memory-alignment",
    title: "Layered memory, selection, and draft flow",
    script: "test:memory-alignment",
    capabilities: ["layered-context", "memory-selection", "memory-drafts", "memory-audit"]
  },
  {
    id: "mac-trust",
    title: "Mac trust surface and cancellation",
    script: "test:mac-trust",
    capabilities: ["trust-status", "permission-settings", "abortable-shell", "visible-context-first"]
  },
  {
    id: "computer-use",
    title: "Magi-compatible Computer Use contract",
    script: "test:computer-use-alignment",
    capabilities: ["computer-use", "app-policy", "teach-mode", "clipboard-policy", "display-selection"]
  }
];

const startedAt = Date.now();
const results = [];

for (const check of checks) {
  const start = Date.now();
  console.log(`\n[capability] ${check.id}: npm run ${check.script}`);
  const result = spawnSync(npmCommand, ["run", check.script], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const passed = result.status === 0;
  results.push({
    id: check.id,
    title: check.title,
    status: passed ? "passed" : "failed",
    score: passed ? 1 : 0,
    command: `npm run ${check.script}`,
    capabilities: check.capabilities,
    durationMs: Date.now() - start,
    exitCode: result.status,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    failures: passed ? [] : [`${check.script} exited with ${result.status ?? "unknown"}`]
  });
}

const failed = results.filter((result) => result.status !== "passed");
const report = {
  version: 1,
  name: "kira-capability-alignment",
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? "passed" : "failed",
  summary: {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    score: results.length === 0
      ? 0
      : results.reduce((sum, result) => sum + result.score, 0) / results.length,
    durationMs: Date.now() - startedAt
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  checks: results
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(formatReport(report));
console.log(`Kira capability report: ${outputPath}`);

if (report.status !== "passed") {
  process.exit(1);
}

function formatReport(report) {
  return [
    "",
    `Kira capability alignment: ${report.status}`,
    `checks: ${report.summary.passed}/${report.summary.total}`,
    `score: ${report.summary.score.toFixed(2)}`,
    ...report.checks.map((check) => {
      const suffix = check.failures.length > 0
        ? ` - ${check.failures.join("; ")}`
        : ` duration=${Math.round(check.durationMs)}ms`;
      return `- ${check.id}: ${check.status}${suffix}`;
    })
  ].join("\n");
}

function tail(value) {
  if (!value) return "";
  const text = String(value);
  return text.length <= 4000 ? text : text.slice(-4000);
}
