#!/usr/bin/env node

const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = join(__dirname, "..");
const nativeRoot = join(root, "native", "mac-computer-use");
const buildOutput = join(nativeRoot, "build", "Release", "kira_mac_computer_use.node");
const distDir = join(root, "dist", "native", "mac-computer-use");
const distOutput = join(distDir, "kira_mac_computer_use.node");

if (process.platform !== "darwin") {
  mkdirSync(join(root, "dist", "native"), { recursive: true });
  console.log("Skipping macOS Computer Use native addon build on non-macOS host.");
  process.exit(0);
}

const nodeGyp = process.platform === "win32"
  ? join(root, "node_modules", ".bin", "node-gyp.cmd")
  : join(root, "node_modules", ".bin", "node-gyp");

const result = spawnSync(nodeGyp, ["rebuild"], {
  cwd: nativeRoot,
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(buildOutput)) {
  console.error(`Native addon build output not found: ${buildOutput}`);
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
copyFileSync(buildOutput, distOutput);
console.log(`Built macOS Computer Use native addon: ${distOutput}`);
