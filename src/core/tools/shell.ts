import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as iconv from "iconv-lite";

import { ToolError } from "./errors.ts";

export interface ShellResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const LONG_RUNNING_PATTERNS = [
  /\bnpm\s+run\s+dev\b/,
  /\bnpm\s+run\s+start\b/,
  /\bnpm\s+start\b/,
  /\byarn\s+dev\b/,
  /\byarn\s+start\b/,
  /\bpnpm\s+dev\b/,
  /\bpnpm\s+start\b/,
  /\bvite(\s|$)/,
  /\bnext\s+dev\b/,
  /\bnuxt\s+dev\b/,
  /\buvicorn\b/,
  /\bflask\s+run\b/,
  /\bdjango.*runserver\b/,
  /\bpython\s+-m\s+http\.server\b/,
  /\bpython\s+-m\s+SimpleHTTPServer\b/,
  /\bnode\s+.*server\b/,
  /\bdeno\s+run\b/,
  /\bbun\s+run\s+dev\b/,
  /\bbun\s+dev\b/,
];

export function isLongRunningCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/&\s*$/.test(trimmed)) return false;
  if (hasBackgroundedLongRunningSegment(trimmed)) return false;
  return LONG_RUNNING_PATTERNS.some((p) => p.test(trimmed));
}

function hasBackgroundedLongRunningSegment(command: string): boolean {
  let segmentStart = 0;
  for (let index = 0; index < command.length; index++) {
    if (!isBackgroundOperator(command, index)) {
      continue;
    }
    const segment = command.slice(segmentStart, index);
    if (LONG_RUNNING_PATTERNS.some((pattern) => pattern.test(segment))) {
      return true;
    }
    segmentStart = index + 1;
  }
  return false;
}

function isBackgroundOperator(command: string, index: number): boolean {
  if (command[index] !== "&") return false;
  const prev = command[index - 1];
  const next = command[index + 1];
  return prev !== "&" && next !== "&" && prev !== ">";
}

export function isDangerousShellCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return [
    /\brm\s+(-[a-z]*[rf][a-z]*|-r\s+-f|-f\s+-r)\b/,
    /\bsudo\b/,
    /\bmkfs\b/,
    /\bdd\s+.*\bof=/,
    /\bchmod\s+777\b/,
    />\s*\/etc\//,
    /\bcurl\b.*\|\s*(sh|bash)\b/,
    /\bwget\b.*\|\s*(sh|bash)\b/
  ].some((pattern) => pattern.test(normalized));
}

export async function runShellCommand(input: {
  cwd: string;
  command: string;
  timeoutMs?: number;
  approveDangerous?: boolean;
  signal?: AbortSignal;
  skipAutoBackground?: boolean;
}): Promise<ShellResult> {
  if (isDangerousShellCommand(input.command) && !input.approveDangerous) {
    throw new ToolError(`Command requires explicit approval: ${input.command}`, "approval-required");
  }

  const isWindows = process.platform === "win32";
  if (!input.skipAutoBackground && isLongRunningCommand(input.command)) {
    if (isWindows) {
      return runWindowsBackgroundCommand(input);
    }
    return runPosixBackgroundCommand(input);
  }

  return new Promise((resolve, reject) => {
    const shellCmd = isWindows ? "cmd.exe" : "bash";
    // On Windows, prefix with `chcp 65001 >nul` to switch to UTF-8 codepage
    const winCommand = `chcp 65001 >nul && ${input.command}`;
    const shellArgs = isWindows ? ["/d", "/s", "/c", winCommand] : ["-lc", input.command];
    const child = spawn(shellCmd, shellArgs, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: isWindows ? { ...process.env, PYTHONIOENCODING: "utf-8" } : process.env,
      detached: !isWindows,
      windowsHide: isWindows
    });
    let stdout = "";
    let stderr = "";
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let stdoutEnded = false;
    let stderrEnded = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let exitCodeFromExit: number | null = null;
    const MAX_OUTPUT = 1024 * 1024; // 1MB cap per stream
    const TRUNC_NOTE = "\n[output truncated at 1MB]\n";
    const truncNoteBuffer = Buffer.from(TRUNC_NOTE, "utf8");

    const killTree = (sig: NodeJS.Signals = "SIGTERM") => {
      if (isWindows) {
        killWindowsProcessTree(child.pid);
        return;
      }
      try {
        if (child.pid) process.kill(-child.pid, sig);
        return;
      } catch {
        try { child.kill(sig); } catch {}
      }
    };

    const decode = (buf: Buffer): string => {
      if (!isWindows) return buf.toString("utf8");
      // Try UTF-8 first; if it has replacement chars, fall back to GBK
      const utf8 = buf.toString("utf8");
      if (!utf8.includes("\uFFFD")) return utf8;
      try { return iconv.decode(buf, "gbk"); } catch { return utf8; }
    };

    const pushLimited = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      const truncated = stream === "stdout" ? stdoutTruncated : stderrTruncated;
      if (truncated) return;
      const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      if (currentBytes + chunk.length > MAX_OUTPUT) {
        const room = MAX_OUTPUT - currentBytes;
        if (room > 0) chunks.push(chunk.subarray(0, room));
        chunks.push(truncNoteBuffer);
        if (stream === "stdout") {
          stdoutBytes = MAX_OUTPUT + truncNoteBuffer.length;
          stdoutTruncated = true;
        } else {
          stderrBytes = MAX_OUTPUT + truncNoteBuffer.length;
          stderrTruncated = true;
        }
        return;
      }
      chunks.push(chunk);
      if (stream === "stdout") {
        stdoutBytes += chunk.length;
      } else {
        stderrBytes += chunk.length;
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (drainTimer) clearTimeout(drainTimer);
      if (killTimer) clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", onStdoutData);
      child.stderr.removeListener("data", onStderrData);
      child.stdout.removeListener("end", onStdoutEnd);
      child.stderr.removeListener("end", onStderrEnd);
    };
    const finish = (exitCode: number | null, destroyStreams = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (destroyStreams) {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      stdout = decode(Buffer.concat(stdoutChunks));
      stderr = decode(Buffer.concat(stderrChunks));
      if (aborted) {
        reject(new ToolError(`Command aborted: ${input.command}`, "timeout"));
        return;
      }
      if (timedOut) {
        reject(new ToolError(`Command timed out after ${input.timeoutMs ?? 30_000}ms: ${input.command}`, "timeout"));
        return;
      }
      resolve({
        command: input.command,
        cwd: input.cwd,
        exitCode,
        stdout,
        stderr,
        timedOut
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      killTimer = setTimeout(() => {
        killTree("SIGKILL");
        finish(exitCodeFromExit, true);
      }, 2000);
    }, input.timeoutMs ?? 30_000);

    const onAbort = () => {
      aborted = true;
      clearTimeout(timer);
      killTree("SIGTERM");
      killTimer = setTimeout(() => {
        killTree("SIGKILL");
        finish(exitCodeFromExit, true);
      }, 1000);
    };
    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
      } else {
        input.signal.addEventListener("abort", onAbort);
      }
    }
    const maybeFinishAfterExit = () => {
      if (exitCodeFromExit === null || !stdoutEnded || !stderrEnded) return;
      finish(exitCodeFromExit);
    };
    const onStdoutData = (chunk: Buffer) => pushLimited(stdoutChunks, chunk, "stdout");
    const onStderrData = (chunk: Buffer) => pushLimited(stderrChunks, chunk, "stderr");
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinishAfterExit();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinishAfterExit();
    };

    child.stdout.on("data", onStdoutData);
    child.stderr.on("data", onStderrData);
    child.stdout.on("end", onStdoutEnd);
    child.stderr.on("end", onStderrEnd);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("exit", (exitCode) => {
      exitCodeFromExit = exitCode;
      // Treat shell exit as the command boundary. Background grandchildren can
      // inherit stdio and keep "close" from firing; give normal pipes a short
      // chance to drain, then detach the streams.
      drainTimer = setTimeout(() => finish(exitCode, true), 50);
      maybeFinishAfterExit();
    });
    child.on("close", (exitCode) => {
      finish(exitCode ?? exitCodeFromExit);
    });
  });
}

async function runPosixBackgroundCommand(input: {
  cwd: string;
  command: string;
  timeoutMs?: number;
  approveDangerous?: boolean;
  signal?: AbortSignal;
  skipAutoBackground?: boolean;
}): Promise<ShellResult> {
  const logFile = join(tmpdir(), `magi-desktop-bg-${Date.now()}.log`);
  const escaped = input.command.replace(/'/g, "'\\''");
  const bgCommand = `nohup bash -c '${escaped}' > ${logFile} 2>&1 < /dev/null & disown; echo "BG_PID=$!"`;
  const bgResult = await runShellCommand({ ...input, command: bgCommand, skipAutoBackground: true });
  return {
    ...bgResult,
    command: input.command,
    stdout:
      `[Auto-backgrounded] Process detached from shell. The process IS running - DO NOT try to verify by re-running it.\n` +
      `Log file: ${logFile}\n` +
      `To check output: cat ${logFile}\n` +
      `To stop: pkill -f '${input.command.split(/\s+/)[0]}'\n` +
      `Wait 3-5 seconds before checking the log for the URL/port.\n` +
      bgResult.stdout,
  };
}

async function runWindowsBackgroundCommand(input: {
  cwd: string;
  command: string;
  timeoutMs?: number;
  approveDangerous?: boolean;
  signal?: AbortSignal;
  skipAutoBackground?: boolean;
}): Promise<ShellResult> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const logFile = join(tmpdir(), `magi-desktop-bg-${stamp}.log`);
  const scriptFile = join(tmpdir(), `magi-desktop-bg-${stamp}.cmd`);
  writeFileSync(scriptFile, [
    "@echo off",
    "chcp 65001 >nul",
    `cd /d ${quoteCmdPath(input.cwd)}`,
    `${input.command} > ${quoteCmdPath(logFile)} 2>&1`
  ].join("\r\n"), "utf8");

  const psCommand = [
    "$ErrorActionPreference = 'Stop'",
    `$script = ${quotePowerShellString(scriptFile)}`,
    `$workdir = ${quotePowerShellString(input.cwd)}`,
    "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/s','/c', ('\"' + $script + '\"')) -WorkingDirectory $workdir -WindowStyle Hidden -PassThru",
    "Write-Output ('BG_PID=' + $p.Id)"
  ].join("; ");

  const bgResult = await runShellCommand({
    ...input,
    command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ${quoteCmdArgument(psCommand)}`,
    skipAutoBackground: true
  });
  const pid = /BG_PID=(\d+)/.exec(bgResult.stdout)?.[1];
  return {
    ...bgResult,
    command: input.command,
    stdout:
      `[Auto-backgrounded] Process detached from shell. The process IS running - DO NOT try to verify by re-running it.\n` +
      `Log file: ${logFile}\n` +
      `To check output: type ${quoteCmdPath(logFile)}\n` +
      `To stop: ${pid ? `taskkill /PID ${pid} /T /F` : "use Task Manager or taskkill to stop the process"}\n` +
      `Wait 3-5 seconds before checking the log for the URL/port.\n` +
      bgResult.stdout,
  };
}

function killWindowsProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.on("error", () => {});
  } catch {}
}

function quoteCmdPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteCmdArgument(value: string): string {
  return `"${value.replace(/(["^&|<>])/g, "^$1").replace(/%/g, "%%")}"`;
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
