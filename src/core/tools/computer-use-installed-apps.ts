import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface InstalledAppDescriptionInfo {
  bundleId: string;
  displayName: string;
  path?: string;
}

const DARWIN_APP_ROOTS = [
  "/Applications",
  path.join(os.homedir(), "Applications"),
  "/System/Applications",
  "/System/Applications/Utilities",
  "/System/Cryptexes/App/System/Applications",
  "/System/Volumes/Preboot/Cryptexes/App/System/Applications"
] as const;

export async function listInstalledAppsForDescription(timeoutMs = 1_000): Promise<InstalledAppDescriptionInfo[] | undefined> {
  if (process.platform === "darwin") {
    return withTimeout(listDarwinInstalledApps(), timeoutMs).catch(() => undefined);
  }
  return undefined;
}

async function listDarwinInstalledApps(): Promise<InstalledAppDescriptionInfo[]> {
  const results = new Map<string, InstalledAppDescriptionInfo>();
  await Promise.all(DARWIN_APP_ROOTS.map(async (root) => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      .map(async (entry) => {
        const appPath = path.join(root, entry.name);
        const info = await readDarwinAppInfo(appPath);
        if (!info || results.has(info.bundleId)) return;
        results.set(info.bundleId, info);
      }));
  }));
  return [...results.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function readDarwinAppInfo(appPath: string): Promise<InstalledAppDescriptionInfo | undefined> {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const json = await execFileText("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath], 500).catch(() => undefined);
  if (!json) return undefined;
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const bundleId = readString(parsed.CFBundleIdentifier);
  if (!bundleId) return undefined;
  return {
    bundleId,
    displayName: readString(parsed.CFBundleDisplayName) || readString(parsed.CFBundleName) || path.basename(appPath, ".app"),
    path: appPath
  };
}

function execFileText(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout || stderr || "");
    });
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, undefined);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
