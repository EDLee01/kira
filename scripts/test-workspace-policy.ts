import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildKiraWorkspaceEnv,
  buildKiraWorkspaceInfo,
  defaultProjectDir,
  ensureKiraWorkspace,
  isPathInside,
  kiraWorkspaceLayout
} from "../src/core/kira-workspace.ts";
import { checkToolPermission, executeRegisteredTool } from "../src/core/tools/registry.ts";
import { runShellCommand } from "../src/core/tools/shell.ts";

async function main() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "kira-workspace-policy-"));
  try {
    const root = path.join(temp, "KiraWorkspace");
    const layout = ensureKiraWorkspace(root);
    const project = defaultProjectDir(root);
    mkdirSync(project, { recursive: true });
    ensureKiraWorkspace(root);

    assert.equal(layout.root, path.resolve(root));
    for (const dir of [
      layout.projectsRoot,
      layout.runtimesRoot,
      layout.downloadsRoot,
      layout.cacheRoot,
      layout.logsRoot,
      layout.artifactsRoot,
      layout.backupsRoot,
      layout.tmpRoot,
      layout.playwrightRoot,
      layout.pythonSitePackages,
      layout.nodeGlobalRoot
    ]) {
      assert.equal(existsSync(dir), true, `expected directory to exist: ${dir}`);
    }

    const insideInfo = buildKiraWorkspaceInfo(root, project);
    assert.equal(insideInfo.isProjectInsideWorkspace, true);

    const externalProject = path.join(temp, "ExternalProject");
    mkdirSync(externalProject, { recursive: true });
    ensureKiraWorkspace(root);
    writeFileSync(path.join(layout.tmpRoot, "touch.txt"), "ok");
    assert.equal(isPathInside(root, project), true);
    assert.equal(isPathInside(root, externalProject), false);
    assert.equal(buildKiraWorkspaceInfo(root, externalProject).isProjectInsideWorkspace, false);

    const externalInstallPermission = checkToolPermission({
      cwd: externalProject,
      kiraWorkspaceRoot: root,
      mode: "auto",
      toolUse: {
        id: "tool-external-install",
        type: "tool-use",
        name: "Bash",
        input: { command: "npm install left-pad" }
      }
    });
    assert.equal(externalInstallPermission.decision, "deny");
    assert.match(externalInstallPermission.reason, /outside the workspace/i);

    const internalInstallPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: root,
      mode: "auto",
      toolUse: {
        id: "tool-internal-install",
        type: "tool-use",
        name: "Bash",
        input: { command: "npm install left-pad" }
      }
    });
    assert.equal(internalInstallPermission.decision, "ask");

    const env = buildKiraWorkspaceEnv({ root, projectDir: project, env: { ...process.env, HOME: temp } as NodeJS.ProcessEnv });
    assert.equal(env.KIRA_WORKSPACE_ROOT, path.resolve(root));
    assert.equal(env.KIRA_PROJECT_DIR, path.resolve(project));
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, kiraWorkspaceLayout(root).playwrightRoot);
    assert.equal(env.PIP_CACHE_DIR, path.join(root, "cache", "pip"));
    assert.equal(env.PIP_TARGET, path.join(root, "runtimes", "python", "site-packages"));
    assert.equal(env.npm_config_cache, path.join(root, "cache", "npm"));
    assert.equal(env.npm_config_prefix, path.join(root, "runtimes", "node", "global"));
    assert.equal(env.PNPM_HOME, path.join(root, "runtimes", "node", "pnpm"));
    assert.match(env.PATH ?? "", /runtimes/);

    const shell = await runShellCommand({
      cwd: project,
      kiraWorkspaceRoot: root,
      env,
      approveDangerous: true,
      command: "node -e \"console.log(process.env.PIP_TARGET); console.log(process.env.PLAYWRIGHT_BROWSERS_PATH); console.log(process.env.KIRA_DOWNLOADS_DIR)\""
    });
    assert.equal(shell.exitCode, 0);
    assert.match(shell.stdout, /runtimes[\/\\]python[\/\\]site-packages/);
    assert.match(shell.stdout, /runtimes[\/\\]playwright/);
    assert.match(shell.stdout, /downloads/);

    const denied = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: root,
      permissionMode: "auto",
      toolUse: {
        id: "tool-deny",
        type: "tool-use",
        name: "Bash",
        input: { command: `mkdir "${path.join(temp, "outside")}"` }
      }
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content, /outside the workspace|outside allowed/i);
    assert.equal(existsSync(path.join(temp, "outside")), false);

    await assert.rejects(
      runShellCommand({
        cwd: externalProject,
        kiraWorkspaceRoot: root,
        approveDangerous: true,
        command: "npm install left-pad"
      }),
      /local package files outside Kira Workspace|outside-workspace|outside the workspace/i
    );
    await assert.rejects(
      runShellCommand({
        cwd: project,
        kiraWorkspaceRoot: root,
        approveDangerous: true,
        command: `npm --prefix "${externalProject}" install left-pad`
      }),
      /local package files outside Kira Workspace|outside-workspace|outside the workspace/i
    );

    const allowed = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: root,
      permissionMode: "auto",
      toolUse: {
        id: "tool-allow",
        type: "tool-use",
        name: "Bash",
        input: { command: "mkdir data && printf ok > data/result.txt" }
      }
    });
    assert.equal(Boolean(allowed.isError), false);
    assert.equal(readFileSync(path.join(project, "data", "result.txt"), "utf8"), "ok");

    console.log("workspace policy tests passed");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
