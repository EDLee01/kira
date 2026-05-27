import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureKiraWorkspace } from "../kira-workspace.ts";
import { callMacComputerUseBridge, isMacComputerUseBridgeAvailable } from "./mac-computer-use-bridge.ts";

const PIP_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple/";
const PIP_TRUSTED_HOST = "pypi.tuna.tsinghua.edu.cn";
const FALLBACK_PIP_INDEX_URL = "https://pypi.org/simple/";

interface RuntimePaths {
  root: string;
  venvRoot: string;
  pythonBin: string;
  pipBin: string;
  requirements: string;
  helper: string;
  installStamp: string;
}

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

let bootstrapPromise: Promise<void> | undefined;
let bootstrapKey: string | undefined;

export async function callComputerUseHelper<T>(input: {
  command: string;
  payload?: Record<string, unknown>;
  cwd: string;
  kiraWorkspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  if (isMacComputerUseBridgeAvailable(input.command)) {
    try {
      return await callMacComputerUseBridge<T>(input.command, input.payload ?? {});
    } catch (error) {
      if (!canFallbackToPythonHelper(input.command)) {
        throw error;
      }
    }
  }

  const runtime = runtimePaths(input);
  await ensureBootstrapped(runtime, input.env, input.signal);
  const result = await execFileNoThrow(runtime.pythonBin, [
    runtime.helper,
    input.command,
    "--payload",
    JSON.stringify(input.payload ?? {})
  ], {
    env: helperEnv(input.env),
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? 60_000,
    maxBuffer: 50 * 1024 * 1024
  });

  let parsed: { ok: boolean; result?: T; error?: { message?: string } };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(result.stderr || result.stdout || `Computer Use helper returned invalid output for ${input.command}`);
  }

  if (!parsed.ok) {
    throw new Error(parsed.error?.message || `Computer Use helper ${input.command} failed`);
  }
  return parsed.result as T;
}

export async function callComputerUseHelperIfReady<T>(input: {
  command: string;
  payload?: Record<string, unknown>;
  cwd: string;
  kiraWorkspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T | undefined> {
  if (isMacComputerUseBridgeAvailable(input.command)) {
    try {
      return await callMacComputerUseBridge<T>(input.command, input.payload ?? {});
    } catch (error) {
      if (!canFallbackToPythonHelper(input.command)) {
        return undefined;
      }
    }
  }

  const runtime = runtimePaths(input);
  if (!(await isRuntimeReady(runtime))) return undefined;
  try {
    const result = await execFileNoThrow(runtime.pythonBin, [
      runtime.helper,
      input.command,
      "--payload",
      JSON.stringify(input.payload ?? {})
    ], {
      env: helperEnv(input.env),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? 1_000,
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.code !== 0) return undefined;
    const parsed = JSON.parse(result.stdout) as { ok: boolean; result?: T };
    return parsed.ok ? parsed.result as T : undefined;
  } catch {
    return undefined;
  }
}

function canFallbackToPythonHelper(command: string): boolean {
  return command === "screenshot"
    || command === "zoom"
    || command === "validate_click_target"
    || command === "resolve_prepare_capture"
    || command === "frontmost_app"
    || command === "app_under_point"
    || command === "list_running_apps"
    || command === "list_installed_apps"
    || command === "open_app"
    || command === "preview_hide_set"
    || command === "prepare_for_action"
    || command === "restore_apps"
    || command === "find_window_displays";
}

function runtimePaths(input: { cwd: string; kiraWorkspaceRoot?: string }): RuntimePaths {
  const root = input.kiraWorkspaceRoot
    ? path.join(ensureKiraWorkspace(input.kiraWorkspaceRoot).runtimesRoot, "computer-use")
    : path.join(path.resolve(input.cwd), "tmp", "computer-use-runtime");
  const venvRoot = path.join(root, "venv");
  const isWindows = process.platform === "win32";
  return {
    root,
    venvRoot,
    pythonBin: isWindows ? path.join(venvRoot, "Scripts", "python.exe") : path.join(venvRoot, "bin", "python3"),
    pipBin: isWindows ? path.join(venvRoot, "Scripts", "pip.exe") : path.join(venvRoot, "bin", "pip"),
    requirements: path.join(root, "requirements.txt"),
    helper: path.join(root, isWindows ? "win_helper.py" : "mac_helper.py"),
    installStamp: path.join(root, "requirements.sha256")
  };
}

async function ensureBootstrapped(runtime: RuntimePaths, env?: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
  const key = `${runtime.root}:${process.platform}`;
  if (bootstrapPromise && bootstrapKey === key) return bootstrapPromise;
  bootstrapKey = key;
  bootstrapPromise = (async () => {
    await syncRuntimeFiles(runtime);

    if (!(await pathExists(runtime.pythonBin))) {
      const python = env?.KIRA_COMPUTER_USE_PYTHON || (process.platform === "win32" ? "python" : "python3");
      await runOrThrow(python, ["-m", "venv", runtime.venvRoot], "Python venv creation", env, signal);
    }

    if (!(await pathExists(runtime.pipBin))) {
      await runOrThrow(runtime.pythonBin, ["-m", "ensurepip", "--upgrade"], "ensurepip", env, signal);
    }

    const requirements = await readFile(runtime.requirements, "utf8");
    const digest = createHash("sha256").update(requirements).digest("hex");
    const installedDigest = await readTextIfExists(runtime.installStamp);
    if (installedDigest.trim() === digest) return;

    await runPipInstall(runtime, ["install", "--upgrade", "pip"], "pip upgrade", env, signal, { optional: true });
    await runPipInstall(runtime, ["install", "-r", runtime.requirements], "Computer Use dependency install", env, signal);
    await writeFile(runtime.installStamp, `${digest}\n`, "utf8");
  })();

  try {
    await bootstrapPromise;
  } catch (error) {
    bootstrapPromise = undefined;
    throw error;
  }
}

async function isRuntimeReady(runtime: RuntimePaths): Promise<boolean> {
  if (!(await pathExists(runtime.pythonBin))) return false;
  if (!(await pathExists(runtime.helper))) return false;
  if (!(await pathExists(runtime.requirements))) return false;
  const requirements = await readTextIfExists(runtime.requirements);
  if (!requirements) return false;
  const digest = createHash("sha256").update(requirements).digest("hex");
  return (await readTextIfExists(runtime.installStamp)).trim() === digest;
}

async function runPipInstall(
  runtime: RuntimePaths,
  args: string[],
  label: string,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  options?: { optional?: boolean }
): Promise<void> {
  const errors: string[] = [];
  for (const index of pipIndexes(env)) {
    const result = await execFileNoThrow(runtime.pythonBin, ["-m", "pip", ...args, ...index.args], {
      env: helperEnv(env),
      signal,
      timeoutMs: 10 * 60_000,
      maxBuffer: 20 * 1024 * 1024
    });
    if (result.code === 0) return;
    errors.push(`${index.label}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  if (options?.optional) return;
  throw new Error(`${label} failed:\n${errors.join("\n\n")}`);
}

function pipIndexes(env?: NodeJS.ProcessEnv): Array<{ label: string; args: string[] }> {
  const configured = env?.KIRA_COMPUTER_USE_PIP_INDEX_URL || env?.PIP_INDEX_URL;
  const trustedHost = env?.KIRA_COMPUTER_USE_PIP_TRUSTED_HOST || env?.PIP_TRUSTED_HOST;
  if (configured) {
    return [{
      label: configured,
      args: ["-i", configured, ...(trustedHost ? ["--trusted-host", trustedHost] : [])]
    }];
  }
  return [
    { label: PIP_INDEX_URL, args: ["-i", PIP_INDEX_URL, "--trusted-host", PIP_TRUSTED_HOST] },
    { label: FALLBACK_PIP_INDEX_URL, args: ["-i", FALLBACK_PIP_INDEX_URL] }
  ];
}

async function syncRuntimeFiles(runtime: RuntimePaths): Promise<void> {
  await mkdir(runtime.root, { recursive: true });
  const sourceRoot = runtimeSourceRoot();
  const reqFile = process.platform === "win32" ? "requirements-win.txt" : "requirements.txt";
  const helperFile = process.platform === "win32" ? "win_helper.py" : "mac_helper.py";
  await writeFile(runtime.requirements, await readFile(path.join(sourceRoot, reqFile), "utf8"), "utf8");
  await writeFile(runtime.helper, await readFile(path.join(sourceRoot, helperFile), "utf8"), "utf8");
}

function runtimeSourceRoot(): string {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  const packagedRuntime = electronProcess.resourcesPath
    ? path.join(electronProcess.resourcesPath, "runtime")
    : undefined;
  if (packagedRuntime) return packagedRuntime;
  return path.join(process.cwd(), "runtime");
}

async function runOrThrow(
  file: string,
  args: string[],
  label: string,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<void> {
  const result = await execFileNoThrow(file, args, {
    env: helperEnv(env),
    signal,
    timeoutMs: 10 * 60_000,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.code !== 0) {
    throw new Error(`${label} failed with code ${result.code}: ${result.stderr || result.stdout || "unknown error"}`);
  }
}

function execFileNoThrow(
  file: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs: number;
    maxBuffer: number;
  }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, {
      env: options.env,
      signal: options.signal,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer
    }, (error, stdout, stderr) => {
      const errorCode = (error as NodeJS.ErrnoException | null)?.code;
      const code = typeof errorCode === "number"
        ? errorCode
        : error
          ? 1
          : 0;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
    });
  });
}

function helperEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...(env ?? process.env),
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYAUTOGUI_HIDE_SUPPORT_PROMPT: "1"
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(target: string): Promise<string> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return "";
  }
}
