import { existsSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface KiraWorkspaceLayout {
  root: string;
  projectsRoot: string;
  runtimesRoot: string;
  downloadsRoot: string;
  cacheRoot: string;
  logsRoot: string;
  artifactsRoot: string;
  backupsRoot: string;
  tmpRoot: string;
  uploadsRoot: string;
  bashLogsRoot: string;
  playwrightRoot: string;
  pythonRoot: string;
  pythonSitePackages: string;
  nodeRoot: string;
  nodeGlobalRoot: string;
  nodeCacheRoot: string;
  pnpmHome: string;
  pnpmStoreRoot: string;
  yarnCacheRoot: string;
  bunRoot: string;
  bunCacheRoot: string;
  cargoHome: string;
  goPath: string;
  gemHome: string;
}

export interface KiraWorkspaceInfo {
  root: string;
  projectDir: string;
  projectsRoot: string;
  isProjectInsideWorkspace: boolean;
  layout: KiraWorkspaceLayout;
}

export function defaultKiraWorkspaceRoot(
  platform = process.platform,
  homeDir = os.homedir()
): string {
  if (process.env.KIRA_WORKSPACE_ROOT?.trim()) {
    return path.resolve(process.env.KIRA_WORKSPACE_ROOT.trim());
  }
  if (platform === "win32") {
    const homeRoot = path.parse(homeDir).root.toUpperCase();
    for (const drive of ["D:\\", "E:\\", "F:\\"]) {
      if (drive.toUpperCase() !== homeRoot && existsSync(drive)) {
        return path.join(drive, "KiraWorkspace");
      }
    }
  }
  return path.join(homeDir, "Documents", "KiraWorkspace");
}

export function kiraWorkspaceLayout(root: string): KiraWorkspaceLayout {
  const normalizedRoot = path.resolve(root);
  const runtimesRoot = path.join(normalizedRoot, "runtimes");
  const cacheRoot = path.join(normalizedRoot, "cache");
  const logsRoot = path.join(normalizedRoot, "logs");
  const artifactsRoot = path.join(normalizedRoot, "artifacts");
  const nodeRoot = path.join(runtimesRoot, "node");
  const pythonRoot = path.join(runtimesRoot, "python");
  const bunRoot = path.join(nodeRoot, "bun");
  return {
    root: normalizedRoot,
    projectsRoot: path.join(normalizedRoot, "projects"),
    runtimesRoot,
    downloadsRoot: path.join(normalizedRoot, "downloads"),
    cacheRoot,
    logsRoot,
    artifactsRoot,
    backupsRoot: path.join(normalizedRoot, "backups"),
    tmpRoot: path.join(normalizedRoot, "tmp"),
    uploadsRoot: path.join(normalizedRoot, "downloads", "uploads"),
    bashLogsRoot: path.join(logsRoot, "bash"),
    playwrightRoot: path.join(runtimesRoot, "playwright"),
    pythonRoot,
    pythonSitePackages: path.join(pythonRoot, "site-packages"),
    nodeRoot,
    nodeGlobalRoot: path.join(nodeRoot, "global"),
    nodeCacheRoot: path.join(cacheRoot, "npm"),
    pnpmHome: path.join(nodeRoot, "pnpm"),
    pnpmStoreRoot: path.join(cacheRoot, "pnpm-store"),
    yarnCacheRoot: path.join(cacheRoot, "yarn"),
    bunRoot,
    bunCacheRoot: path.join(cacheRoot, "bun"),
    cargoHome: path.join(runtimesRoot, "cargo"),
    goPath: path.join(runtimesRoot, "go"),
    gemHome: path.join(runtimesRoot, "ruby", "gems")
  };
}

export function ensureKiraWorkspace(root: string): KiraWorkspaceLayout {
  const layout = kiraWorkspaceLayout(root);
  for (const dir of Object.values(layout)) {
    mkdirSync(dir, { recursive: true });
  }
  return layout;
}

export function defaultProjectDir(root: string): string {
  return path.join(kiraWorkspaceLayout(root).projectsRoot, "default");
}

export function buildKiraWorkspaceInfo(root: string, projectDir: string): KiraWorkspaceInfo {
  const layout = ensureKiraWorkspace(root);
  const resolvedProject = path.resolve(projectDir);
  return {
    root: layout.root,
    projectDir: resolvedProject,
    projectsRoot: layout.projectsRoot,
    isProjectInsideWorkspace: isPathInside(layout.root, resolvedProject),
    layout
  };
}

export function isPathInside(root: string, candidate: string): boolean {
  const realRoot = safeRealpath(path.resolve(root));
  const realCandidate = safeRealpath(path.resolve(candidate));
  const relative = path.relative(realRoot, realCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function buildKiraWorkspaceEnv(input: {
  root: string;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const base = input.env ?? process.env;
  const layout = ensureKiraWorkspace(input.root);
  const prependPath = [
    path.join(layout.nodeGlobalRoot, process.platform === "win32" ? "" : "bin"),
    layout.pnpmHome,
    path.join(layout.bunRoot, "bin"),
    path.join(layout.cargoHome, "bin"),
    path.join(layout.goPath, "bin"),
    path.join(layout.gemHome, "bin")
  ].filter(Boolean);
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const oldPath = base[pathKey] ?? base.PATH ?? "";
  const oldPythonPath = base.PYTHONPATH;
  return {
    ...base,
    KIRA_WORKSPACE_ROOT: layout.root,
    KIRA_PROJECT_DIR: path.resolve(input.projectDir),
    KIRA_PROJECTS_DIR: layout.projectsRoot,
    KIRA_DOWNLOADS_DIR: layout.downloadsRoot,
    KIRA_ARTIFACTS_DIR: layout.artifactsRoot,
    KIRA_BACKUPS_DIR: layout.backupsRoot,
    KIRA_RUNTIME_DIR: layout.runtimesRoot,
    KIRA_CACHE_DIR: layout.cacheRoot,
    KIRA_LOGS_DIR: layout.logsRoot,
    KIRA_TMP_DIR: layout.tmpRoot,
    KIRA_UPLOADS_DIR: layout.uploadsRoot,
    KIRA_BASH_LOG_DIR: layout.bashLogsRoot,
    PLAYWRIGHT_BROWSERS_PATH: layout.playwrightRoot,
    PIP_CACHE_DIR: path.join(layout.cacheRoot, "pip"),
    PIP_TARGET: layout.pythonSitePackages,
    PYTHONUSERBASE: path.join(layout.pythonRoot, "userbase"),
    PYTHONPATH: oldPythonPath ? `${layout.pythonSitePackages}${path.delimiter}${oldPythonPath}` : layout.pythonSitePackages,
    npm_config_cache: layout.nodeCacheRoot,
    npm_config_prefix: layout.nodeGlobalRoot,
    NPM_CONFIG_CACHE: layout.nodeCacheRoot,
    NPM_CONFIG_PREFIX: layout.nodeGlobalRoot,
    PNPM_HOME: layout.pnpmHome,
    pnpm_config_store_dir: layout.pnpmStoreRoot,
    YARN_CACHE_FOLDER: layout.yarnCacheRoot,
    BUN_INSTALL: layout.bunRoot,
    BUN_INSTALL_CACHE_DIR: layout.bunCacheRoot,
    CARGO_HOME: layout.cargoHome,
    GOPATH: layout.goPath,
    GEM_HOME: layout.gemHome,
    TMPDIR: layout.tmpRoot,
    TEMP: process.platform === "win32" ? layout.tmpRoot : base.TEMP,
    TMP: process.platform === "win32" ? layout.tmpRoot : base.TMP,
    [pathKey]: [prependPath.join(path.delimiter), oldPath].filter(Boolean).join(path.delimiter)
  };
}

function safeRealpath(value: string): string {
  const tail: string[] = [];
  let current = value;
  while (true) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return value;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}
