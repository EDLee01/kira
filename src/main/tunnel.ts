/**
 * Cloudflare Quick Tunnel — zero-config public URL for remote access.
 * Downloads cloudflared binary on first use, starts tunnel, parses URL.
 */
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { getMagiPaths } from "../core/paths.ts";

const CLOUDFLARED_URLS: Record<string, string> = {
  "darwin-arm64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
  "darwin-x64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
  "linux-x64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
  "win32-x64": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
};

let tunnelProcess: ChildProcess | null = null;
let currentUrl: string | null = null;

function getBinDir(): string {
  const paths = getMagiPaths(process.env);
  const binDir = path.join(paths.stateRoot, "..", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  return binDir;
}

function getBinaryPath(): string {
  const binDir = getBinDir();
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(binDir, `cloudflared${ext}`);
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string) => {
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", reject);
    };
    follow(url);
  });
}

async function ensureBinary(): Promise<string> {
  const binPath = getBinaryPath();
  if (fs.existsSync(binPath)) return binPath;

  const key = `${process.platform}-${process.arch}`;
  const url = CLOUDFLARED_URLS[key];
  if (!url) throw new Error(`Unsupported platform: ${key}`);

  if (url.endsWith(".tgz")) {
    // Download tgz and extract
    const tgzPath = binPath + ".tgz";
    await downloadFile(url, tgzPath);
    const { execSync } = await import("child_process");
    execSync(`tar -xzf "${tgzPath}" -C "${getBinDir()}"`, { stdio: "ignore" });
    fs.unlinkSync(tgzPath);
  } else {
    await downloadFile(url, binPath);
  }

  fs.chmodSync(binPath, 0o755);
  return binPath;
}

export async function startTunnel(port: number): Promise<string> {
  if (tunnelProcess) {
    throw new Error("Tunnel already running");
  }

  const binary = await ensureBinary();

  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    tunnelProcess = proc;
    let resolved = false;

    const onData = (data: Buffer) => {
      const line = data.toString();
      console.log("[tunnel]", line.trim());
      // Cloudflared prints the URL in stderr
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        currentUrl = match[0];
        resolve(currentUrl);
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("error", (err) => {
      tunnelProcess = null;
      if (!resolved) reject(err);
    });

    proc.on("exit", () => {
      tunnelProcess = null;
      currentUrl = null;
    });

    // Timeout after 30s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Tunnel startup timed out"));
      }
    }, 30000);
  });
}

export function stopTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
    currentUrl = null;
  }
}

export function getTunnelUrl(): string | null {
  return currentUrl;
}

export function isTunnelRunning(): boolean {
  return tunnelProcess !== null;
}
