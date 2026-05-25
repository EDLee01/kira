import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureKiraWorkspace } from "../kira-workspace.ts";

export interface ComputerUseLockContext {
  cwd: string;
  kiraWorkspaceRoot?: string;
  sessionId?: string;
}

export type ComputerUseLockCheck =
  | { kind: "free" }
  | { kind: "held_by_self" }
  | { kind: "blocked"; by: string };

export type ComputerUseLockAcquire =
  | { kind: "acquired"; fresh: boolean }
  | { kind: "blocked"; by: string };

interface ComputerUseLockRecord {
  sessionId: string;
  pid: number;
  acquiredAt: number;
}

const LOCK_FILENAME = "computer-use.lock";
const localLocks = new Set<string>();

export async function checkComputerUseLock(context: ComputerUseLockContext): Promise<ComputerUseLockCheck> {
  const existing = readLock(context);
  if (!existing) return { kind: "free" };
  if (existing.sessionId === computerUseLockSessionId(context)) return { kind: "held_by_self" };
  if (isProcessRunning(existing.pid)) return { kind: "blocked", by: existing.sessionId };
  removeLock(context);
  return { kind: "free" };
}

export async function acquireComputerUseLock(context: ComputerUseLockContext): Promise<ComputerUseLockAcquire> {
  const sessionId = computerUseLockSessionId(context);
  const lockPath = getLockPath(context);
  const record: ComputerUseLockRecord = { sessionId, pid: process.pid, acquiredAt: Date.now() };
  mkdirSync(path.dirname(lockPath), { recursive: true });

  if (tryCreateLock(lockPath, record)) {
    localLocks.add(lockPath);
    return { kind: "acquired", fresh: true };
  }

  const existing = readLock(context);
  if (!existing) {
    removeLock(context);
    if (tryCreateLock(lockPath, record)) {
      localLocks.add(lockPath);
      return { kind: "acquired", fresh: true };
    }
    return { kind: "blocked", by: readLock(context)?.sessionId ?? "unknown" };
  }
  if (existing.sessionId === sessionId) {
    localLocks.add(lockPath);
    return { kind: "acquired", fresh: false };
  }
  if (isProcessRunning(existing.pid)) return { kind: "blocked", by: existing.sessionId };

  removeLock(context);
  if (tryCreateLock(lockPath, record)) {
    localLocks.add(lockPath);
    return { kind: "acquired", fresh: true };
  }
  return { kind: "blocked", by: readLock(context)?.sessionId ?? "unknown" };
}

export async function releaseComputerUseLock(context: ComputerUseLockContext): Promise<boolean> {
  const lockPath = getLockPath(context);
  localLocks.delete(lockPath);
  const existing = readLock(context);
  if (!existing || existing.sessionId !== computerUseLockSessionId(context)) return false;
  removeLock(context);
  return true;
}

export function isComputerUseLockHeldLocally(context: ComputerUseLockContext): boolean {
  return localLocks.has(getLockPath(context));
}

function getLockPath(context: ComputerUseLockContext): string {
  if (context.kiraWorkspaceRoot) {
    return path.join(ensureKiraWorkspace(context.kiraWorkspaceRoot).tmpRoot, LOCK_FILENAME);
  }
  return path.join(os.homedir(), ".kira", LOCK_FILENAME);
}

function computerUseLockSessionId(context: ComputerUseLockContext): string {
  return context.sessionId || context.kiraWorkspaceRoot || context.cwd || "default";
}

function readLock(context: ComputerUseLockContext): ComputerUseLockRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(getLockPath(context), "utf8")) as unknown;
    if (!isLockRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function tryCreateLock(lockPath: string, record: ComputerUseLockRecord): boolean {
  try {
    writeFileSync(lockPath, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") return false;
    throw error;
  }
}

function removeLock(context: ComputerUseLockContext): void {
  rmSync(getLockPath(context), { force: true });
}

function isLockRecord(value: unknown): value is ComputerUseLockRecord {
  return typeof value === "object"
    && value !== null
    && "sessionId" in value
    && typeof value.sessionId === "string"
    && "pid" in value
    && typeof value.pid === "number"
    && "acquiredAt" in value
    && typeof value.acquiredAt === "number";
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
