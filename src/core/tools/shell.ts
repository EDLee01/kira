import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as iconv from "iconv-lite";

import { ToolError } from "./errors.ts";
import { resolveWorkspacePathFrom } from "./workspace.ts";

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
    /\bwget\b.*\|\s*(sh|bash)\b/,
    /\b(npm|pnpm|yarn|bun)\s+(install|add|i|ci)\b/,
    /(^|[;&|]\s*)yarn\s*($|[;&|])/,
    /\bnpx\s+playwright\s+install\b/,
    /\bplaywright\s+install\b/,
    /\bpython\s+-m\s+playwright\s+install\b/,
    /\bpip3?\s+install\b/,
    /\bpython\s+-m\s+pip\s+install\b/,
    /\bbrew\s+install\b/,
    /\b(cargo|gem)\s+install\b/,
    /\bgo\s+install\b/,
    /\bcomposer\s+global\s+require\b/,
    /\b(winget|choco|scoop)\s+install\b/,
    /\b(apt|apt-get|dnf|yum|pacman|zypper)\s+install\b/
  ].some((pattern) => pattern.test(normalized)) || hasInlineCodeExecution(command);
}

export interface WorkspaceShellViolation {
  command: string;
  path: string;
  reason: string;
}

const FILE_MUTATION_COMMANDS = new Set([
  "cp",
  "mv",
  "move",
  "rm",
  "del",
  "erase",
  "mkdir",
  "md",
  "rmdir",
  "rd",
  "touch",
  "ln",
  "ren",
  "rename",
  "chmod",
  "chown",
  "install",
  "tee",
  "copy",
  "xcopy",
  "robocopy",
  "cpi",
  "mi",
  "ri",
  "ni",
  "rni",
  "ac",
  "clc",
  "move-item",
  "copy-item",
  "remove-item",
  "new-item",
  "rename-item",
  "set-content",
  "add-content",
  "clear-content",
  "out-file"
]);

const COMMAND_SEPARATORS = new Set([";", "&&", "||", "|"]);
const POWERSHELL_FILE_COMMANDS = new Set([
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
  "set-content",
  "add-content",
  "clear-content",
  "out-file",
  "cp",
  "copy",
  "cpi",
  "mv",
  "move",
  "mi",
  "rm",
  "del",
  "erase",
  "rmdir",
  "rd",
  "ri",
  "mkdir",
  "md",
  "ni",
  "ren",
  "rni",
  "ac",
  "clc"
]);

export function findWorkspaceShellViolation(input: {
  cwd: string;
  command: string;
}): WorkspaceShellViolation | undefined {
  return findWorkspaceShellViolationInternal({
    cwd: input.cwd,
    command: input.command,
    initialDir: input.cwd,
    depth: 0,
    variables: createShellVariableMap(input.cwd)
  });
}

function findWorkspaceShellViolationInternal(input: {
  cwd: string;
  command: string;
  initialDir: string;
  depth: number;
  variables: Map<string, string>;
}): WorkspaceShellViolation | undefined {
  const tokens = tokenizeShellCommand(input.command);
  let currentDir = input.initialDir;
  const variables = new Map(input.variables);

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (COMMAND_SEPARATORS.has(token)) {
      continue;
    }

    const assignment = parseShellAssignment(token);
    if (assignment) {
      variables.set(assignment.name, expandShellPathToken(assignment.value, variables));
      continue;
    }

    const redirection = parseOutputRedirection(tokens, index);
    if (redirection) {
      const expandedPath = expandShellPathToken(redirection.path, variables);
      if (hasUnresolvedShellPathSyntax(expandedPath)) {
        return {
          command: "redirect",
          path: expandedPath,
          reason: "output redirection target uses dynamic shell expansion and cannot be verified"
        };
      }
      const resolved = resolveShellPath(input.cwd, currentDir, expandedPath);
      if (!resolved.ok) {
        return {
          command: "redirect",
          path: expandedPath,
          reason: "output redirection target is outside the workspace"
        };
      }
      index = redirection.index;
      continue;
    }

    const commandName = normalizeCommandName(token);
    const nestedShellCommand = readNestedShellCommand(commandName, tokens, index);
    if (nestedShellCommand && input.depth < 3) {
      const violation = findWorkspaceShellViolationInternal({
        cwd: input.cwd,
        command: nestedShellCommand.command,
        initialDir: currentDir,
        depth: input.depth + 1,
        variables
      });
      if (violation) return violation;
      index = nestedShellCommand.index;
      continue;
    }
    const inlineCode = readInlineCodeCommand(commandName, tokens, index);
    if (inlineCode) {
      const violation = findInlineCodeViolation({
        cwd: input.cwd,
        currentDir,
        command: commandName,
        code: inlineCode.code,
        variables
      });
      if (violation) return violation;
      index = inlineCode.index;
      continue;
    }

    if (commandName === "cd" || commandName === "chdir" || commandName === "set-location") {
      const next = nextShellArgument(tokens, index + 1, commandName);
      if (!next) {
        currentDir = input.cwd;
        continue;
      }
      const expandedPath = expandShellPathToken(next.value, variables);
      if (hasUnresolvedShellPathSyntax(expandedPath)) {
        return {
          command: "cd",
          path: expandedPath,
          reason: "cd target uses dynamic shell expansion and cannot be verified"
        };
      }
      const resolved = resolveShellPath(input.cwd, currentDir, expandedPath);
      if (!resolved.ok) {
        return { command: "cd", path: expandedPath, reason: "cd target is outside the workspace" };
      }
      currentDir = resolved.absolutePath;
      index = next.index;
      continue;
    }

    if (FILE_MUTATION_COMMANDS.has(commandName)) {
      const violation = findFileMutationViolation({
        cwd: input.cwd,
        currentDir,
        command: commandName,
        tokens,
        startIndex: index + 1,
        variables
      });
      if (violation) return violation;
    }
  }

  return undefined;
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
  const workspaceViolation = findWorkspaceShellViolation(input);
  if (workspaceViolation) {
    throw new ToolError(formatWorkspaceShellViolation(workspaceViolation), "outside-workspace");
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

function findFileMutationViolation(input: {
  cwd: string;
  currentDir: string;
  command: string;
  tokens: string[];
  startIndex: number;
  variables: Map<string, string>;
}): WorkspaceShellViolation | undefined {
  for (let index = input.startIndex; index < input.tokens.length; index++) {
    const token = input.tokens[index];
    if (COMMAND_SEPARATORS.has(token)) break;
    const pathOption = readPowerShellPathOption(input.command, input.tokens, index);
    if (pathOption) {
      const expandedPath = expandShellPathToken(pathOption.path, input.variables);
      if (hasUnresolvedShellPathSyntax(expandedPath)) {
        return {
          command: input.command,
          path: expandedPath,
          reason: `${input.command} path uses dynamic shell expansion and cannot be verified`
        };
      }
      const resolved = resolveShellPath(input.cwd, input.currentDir, expandedPath);
      if (!resolved.ok) {
        return {
          command: input.command,
          path: expandedPath,
          reason: `${input.command} path is outside the workspace`
        };
      }
      index = pathOption.index;
      continue;
    }
    if (!shouldTreatAsPathArgument(input.command, token)) {
      if (shouldSkipPowerShellValueArgument(input.command, token)) index++;
      continue;
    }

    const expandedPath = expandShellPathToken(token, input.variables);
    if (hasUnresolvedShellPathSyntax(expandedPath)) {
      return {
        command: input.command,
        path: expandedPath,
        reason: `${input.command} path uses dynamic shell expansion and cannot be verified`
      };
    }
    const resolved = resolveShellPath(input.cwd, input.currentDir, expandedPath);
    if (!resolved.ok) {
      return {
        command: input.command,
        path: expandedPath,
        reason: `${input.command} path is outside the workspace`
      };
    }
  }
  return undefined;
}

function shouldTreatAsPathArgument(command: string, token: string): boolean {
  if (!token || token === "--") return false;
  if (isShellOptionToken(token)) return false;
  if (isPowerShellNamedParameter(token)) return false;
  if (isOutputRedirectionToken(token)) return false;
  if (command === "chmod" && /^[0-7]{3,4}$/.test(token)) return false;
  if (command === "chown" && /^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/.test(token) && !token.includes("/") && !token.startsWith(".")) return false;
  return true;
}

function parseOutputRedirection(tokens: string[], index: number): { path: string; index: number } | undefined {
  const token = tokens[index];
  if (isOutputRedirectionToken(token)) {
    const next = tokens[index + 1];
    if (!next || COMMAND_SEPARATORS.has(next) || isDescriptorRedirect(next)) return undefined;
    return { path: next, index: index + 1 };
  }
  const inline = /^(?:\d*>>?|\d*>\||&>>?)(.+)$/.exec(token);
  if (!inline || isDescriptorRedirect(token)) return undefined;
  return { path: inline[1], index };
}

function isOutputRedirectionToken(token: string): boolean {
  return /^(?:\d*>>?|\d*>\||&>>?)$/.test(token);
}

function isDescriptorRedirect(token: string): boolean {
  return /^\d*>\&\d+$/.test(token) || /^\d*>\&-$/.test(token);
}

function resolveShellPath(cwd: string, baseDir: string, requestedPath: string):
  | { ok: true; absolutePath: string }
  | { ok: false } {
  try {
    return { ok: true, absolutePath: resolveWorkspacePathFrom(cwd, baseDir, requestedPath).absolutePath };
  } catch (error) {
    if (error instanceof ToolError && error.kind === "outside-workspace") {
      return { ok: false };
    }
    throw error;
  }
}

function formatWorkspaceShellViolation(violation: WorkspaceShellViolation): string {
  return `Shell command denied: ${violation.reason}: ${violation.path}. Kira can only mutate files inside the selected workspace.`;
}

function nextShellArgument(tokens: string[], startIndex: number, command = ""): { value: string; index: number } | undefined {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (COMMAND_SEPARATORS.has(token)) return undefined;
    if (isShellOptionToken(token)) {
      if (shouldSkipPowerShellValueArgument(command, token)) index++;
      continue;
    }
    return { value: token, index };
  }
  return undefined;
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaped = false;

  const push = () => {
    if (!current) return;
    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && shouldTreatBackslashAsEscape(command, index)) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    const two = command.slice(index, index + 2);
    if (two === "&&" || two === "||") {
      push();
      tokens.push(two);
      index++;
      continue;
    }
    if (char === ";" || char === "|") {
      push();
      tokens.push(char);
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

function parseShellAssignment(token: string): { name: string; value: string } | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(token);
  if (!match) return undefined;
  return { name: match[1], value: match[2] };
}

function normalizeCommandName(token: string): string {
  const normalized = token.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/i, "");
  return basename(normalized);
}

function readNestedShellCommand(
  commandName: string,
  tokens: string[],
  commandIndex: number
): { command: string; index: number } | undefined {
  if (commandName === "cmd") {
    return readCommandAfterOption(tokens, commandIndex + 1, ["/c", "/k"]);
  }
  if (commandName === "powershell" || commandName === "pwsh") {
    return readCommandAfterOption(tokens, commandIndex + 1, ["-command", "-c", "/c"]);
  }
  if (commandName === "bash" || commandName === "sh" || commandName === "zsh") {
    return readCommandAfterOption(tokens, commandIndex + 1, ["-c", "-lc"]);
  }
  return undefined;
}

function readInlineCodeCommand(
  commandName: string,
  tokens: string[],
  commandIndex: number
): { code: string; index: number } | undefined {
  const codeOptions = inlineCodeOptionsForCommand(commandName);
  if (codeOptions.length === 0) return undefined;
  for (let index = commandIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (COMMAND_SEPARATORS.has(token)) return undefined;
    if (!codeOptions.includes(token.toLowerCase())) continue;
    const next = tokens[index + 1];
    if (!next || COMMAND_SEPARATORS.has(next)) return undefined;
    return { code: next, index: index + 1 };
  }
  return undefined;
}

function inlineCodeOptionsForCommand(commandName: string): string[] {
  if (commandName === "python" || commandName === "python3" || commandName === "py") return ["-c"];
  if (commandName === "node" || commandName === "deno" || commandName === "bun") return ["-e", "--eval", "--print", "-p"];
  if (commandName === "ruby" || commandName === "perl" || commandName === "php") return ["-e", "-r"];
  if (commandName === "osascript") return ["-e"];
  return [];
}

function hasInlineCodeExecution(command: string): boolean {
  const tokens = tokenizeShellCommand(command);
  for (let index = 0; index < tokens.length; index++) {
    const commandName = normalizeCommandName(tokens[index]);
    if (readInlineCodeCommand(commandName, tokens, index)) return true;
  }
  return false;
}

function findInlineCodeViolation(input: {
  cwd: string;
  currentDir: string;
  command: string;
  code: string;
  variables: Map<string, string>;
}): WorkspaceShellViolation | undefined {
  if (!inlineCodeMayMutate(input.code)) return undefined;
  const literals = extractPathLikeLiterals(input.code);
  if (literals.length === 0) {
    return {
      command: input.command,
      path: input.code,
      reason: `${input.command} inline code may mutate files but no static path could be verified`
    };
  }
  for (const literal of literals) {
    const expandedPath = expandShellPathToken(literal, input.variables);
    if (hasUnresolvedShellPathSyntax(expandedPath)) {
      return {
        command: input.command,
        path: expandedPath,
        reason: `${input.command} inline code uses dynamic shell expansion and cannot be verified`
      };
    }
    const resolved = resolveShellPath(input.cwd, input.currentDir, expandedPath);
    if (!resolved.ok) {
      return {
        command: input.command,
        path: expandedPath,
        reason: `${input.command} inline code may mutate outside the workspace`
      };
    }
  }
  return undefined;
}

function inlineCodeMayMutate(code: string): boolean {
  return /\b(unlink|remove|rename|rmdir|mkdir|writeFile|appendFile|rmSync|unlinkSync|renameSync|mkdirSync|rmdirSync|writeFileSync|appendFileSync|openSync|createWriteStream|copyFile|copyFileSync|Move-Item|Copy-Item|Remove-Item|New-Item|Set-Content|Add-Content|Clear-Content)\b/i.test(code);
}

function extractPathLikeLiterals(code: string): string[] {
  const literals: string[] = [];
  const pattern = /(["'`])((?:\\.|(?!\1).)+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const value = unescapeInlineLiteral(match[2]);
    if (looksLikePathLiteral(value)) literals.push(value);
  }
  return literals;
}

function unescapeInlineLiteral(value: string): string {
  return value
    .replace(/\\(["'`\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function looksLikePathLiteral(value: string): boolean {
  return value.startsWith("/")
    || value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith("~/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.includes("\\")
    || value.includes("/");
}

function readCommandAfterOption(
  tokens: string[],
  startIndex: number,
  optionNames: string[]
): { command: string; index: number } | undefined {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (COMMAND_SEPARATORS.has(token)) return undefined;
    const normalized = token.toLowerCase();
    if (!optionNames.includes(normalized)) continue;
    const commandStart = index + 1;
    const commandEnd = findCommandSegmentEnd(tokens, commandStart);
    if (commandEnd <= commandStart) return undefined;
    return {
      command: tokens.slice(commandStart, commandEnd).join(" "),
      index: commandEnd - 1
    };
  }
  return undefined;
}

function findCommandSegmentEnd(tokens: string[], startIndex: number): number {
  for (let index = startIndex; index < tokens.length; index++) {
    if (COMMAND_SEPARATORS.has(tokens[index])) return index;
  }
  return tokens.length;
}

function shouldTreatBackslashAsEscape(command: string, index: number): boolean {
  if (looksLikeWindowsShell(command)) return false;
  const next = command[index + 1];
  return next !== undefined;
}

function looksLikeWindowsShell(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(command)
    || /\b[A-Za-z]:\\/.test(command)
    || /\\\\[A-Za-z0-9_.-]+\\/.test(command);
}

function isShellOptionToken(token: string): boolean {
  return token.startsWith("-") || /^\/[A-Za-z?][A-Za-z0-9?]*:?$/i.test(token);
}

function shouldSkipPowerShellValueArgument(command: string, token: string): boolean {
  if (!isPowerShellFileCommand(command)) return false;
  return [
    "-name",
    "-itemtype",
    "-type",
    "-value",
    "-encoding",
    "-filter",
    "-include",
    "-exclude",
    "-credential",
    "-stream"
  ].includes(token.toLowerCase());
}

function readPowerShellPathOption(command: string, tokens: string[], index: number): { path: string; index: number } | undefined {
  if (!isPowerShellFileCommand(command)) return undefined;
  const token = tokens[index].toLowerCase();
  if (![
    "-path",
    "-literalpath",
    "-destination",
    "-target",
    "-filepath"
  ].includes(token)) {
    return undefined;
  }
  const next = tokens[index + 1];
  if (!next || COMMAND_SEPARATORS.has(next)) return undefined;
  return { path: next, index: index + 1 };
}

function isPowerShellFileCommand(command: string): boolean {
  return command.includes("-") || POWERSHELL_FILE_COMMANDS.has(command);
}

function isPowerShellNamedParameter(token: string): boolean {
  return /^-[A-Za-z][A-Za-z0-9-]*$/.test(token);
}

function createShellVariableMap(cwd: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) variables.set(key, value);
  }
  variables.set("PWD", cwd);
  variables.set("OLDPWD", cwd);
  if (process.env.HOME) variables.set("HOME", process.env.HOME);
  if (process.env.USERPROFILE) variables.set("USERPROFILE", process.env.USERPROFILE);
  if (process.env.TMPDIR) variables.set("TMPDIR", process.env.TMPDIR);
  if (process.env.TEMP) variables.set("TEMP", process.env.TEMP);
  if (process.env.TMP) variables.set("TMP", process.env.TMP);
  return variables;
}

function expandShellPathToken(token: string, variables: Map<string, string>): string {
  let expanded = token;
  if (expanded === "~") {
    expanded = readShellVariable(variables, "HOME") ?? expanded;
  } else if (expanded.startsWith("~/")) {
    const home = readShellVariable(variables, "HOME");
    if (home) expanded = join(home, expanded.slice(2));
  } else if (expanded.startsWith("~\\")) {
    const home = readShellVariable(variables, "HOME") ?? readShellVariable(variables, "USERPROFILE");
    if (home) expanded = join(home, expanded.slice(2));
  }
  expanded = expanded.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gi, (_match, name: string) => {
    return readShellVariable(variables, name) ?? _match;
  });
  expanded = expanded.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_match, name: string) => {
    return readShellVariable(variables, name) ?? _match;
  });
  expanded = expanded.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return readShellVariable(variables, name) ?? _match;
  });
  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
    return readShellVariable(variables, name) ?? _match;
  });
  expanded = expanded.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_match, name: string) => {
    return readShellVariable(variables, name) ?? _match;
  });
  return expanded;
}

function readShellVariable(variables: Map<string, string>, name: string): string | undefined {
  const direct = variables.get(name) ?? variables.get(name.toUpperCase()) ?? variables.get(name.toLowerCase());
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of variables) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function hasUnresolvedShellPathSyntax(token: string): boolean {
  return token.startsWith("~")
    || /\$\{?[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?\}?/.test(token)
    || /%[A-Za-z_][A-Za-z0-9_]*%/.test(token)
    || /\$\(|`|<\(|>\(/.test(token);
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
