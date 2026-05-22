import { spawn } from "node:child_process";
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
}): Promise<ShellResult> {
  if (isDangerousShellCommand(input.command) && !input.approveDangerous) {
    throw new ToolError(`Command requires explicit approval: ${input.command}`, "approval-required");
  }

  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const shellCmd = isWindows ? "cmd.exe" : "bash";
    // On Windows, prefix with `chcp 65001 >nul` to switch to UTF-8 codepage
    const winCommand = `chcp 65001 >nul && ${input.command}`;
    const shellArgs = isWindows ? ["/c", winCommand] : ["-lc", input.command];
    const child = spawn(shellCmd, shellArgs, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: isWindows ? { ...process.env, PYTHONIOENCODING: "utf-8" } : process.env
    });
    let stdout = "";
    let stderr = "";
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs ?? 30_000);

    const decode = (buf: Buffer): string => {
      if (!isWindows) return buf.toString("utf8");
      // Try UTF-8 first; if it has replacement chars, fall back to GBK
      const utf8 = buf.toString("utf8");
      if (!utf8.includes("\uFFFD")) return utf8;
      try { return iconv.decode(buf, "gbk"); } catch { return utf8; }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      stdout = decode(Buffer.concat(stdoutChunks));
      stderr = decode(Buffer.concat(stderrChunks));
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
    });
  });
}
