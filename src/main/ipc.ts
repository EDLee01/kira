import { ipcMain, BrowserWindow, dialog } from "electron";
import { Engine } from "./engine";
import { SessionStore } from "../core/session-store.ts";
import { getMagiPaths } from "../core/paths.ts";
import { loadConfig } from "../core/config.ts";
import * as fs from "fs";
import * as path from "path";

export function registerIPC(win: BrowserWindow): void {
  const paths = getMagiPaths(process.env);
  const store = SessionStore.open(paths);
  const engine = new Engine(win, store);

  // ── Sessions ──

  ipcMain.handle("sessions:list", () => {
    return store.listSessions(50);
  });

  ipcMain.handle("sessions:create", (_event, title?: string) => {
    return store.createSession({ title: title ?? "New conversation", cwd: engine.cwd });
  });

  ipcMain.handle("sessions:delete", (_event, id: string) => {
    return store.deleteSession(id);
  });

  ipcMain.handle("sessions:rename", (_event, id: string, title: string) => {
    return store.renameSession(id, title);
  });

  ipcMain.handle("sessions:get", (_event, id: string) => {
    const session = store.getSession(id);
    if (!session) return null;
    return {
      ...session,
      messages: session.messages.map((m: any) => {
        try {
          return { ...m, content: JSON.parse(m.content) };
        } catch {
          return m;
        }
      }),
    };
  });

  // ── Engine ──

  ipcMain.handle("engine:query", async (_event, sessionId: string, text: string) => {
    // Ensure the user message is saved to the session
    if (!store.getSession(sessionId)) {
      store.createSession({ id: sessionId, title: text.slice(0, 80), cwd: engine.cwd });
    }
    store.appendMessage({
      sessionId,
      role: "user",
      content: JSON.stringify({ type: "text", text }),
      metadata: {},
    });
    await engine.startQuery(sessionId, text);
  });

  ipcMain.handle("engine:cancel", () => {
    engine.cancelQuery();
  });

  ipcMain.handle("engine:status", () => {
    return { running: engine.running, sessionId: engine.sessionId };
  });

  // ── Config ──

  ipcMain.handle("config:get", () => {
    try {
      return loadConfig(paths, process.env);
    } catch {
      return { error: "Config not found" };
    }
  });

  // ── Workspace ──

  ipcMain.handle("workspace:get", () => {
    return engine.cwd;
  });

  ipcMain.handle("workspace:pick", async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "选择工作区",
    });
    if (!result.canceled && result.filePaths[0]) {
      engine.cwd = result.filePaths[0];
      return engine.cwd;
    }
    return null;
  });

  ipcMain.handle("workspace:set", (_event, dir: string) => {
    engine.cwd = dir;
    return engine.cwd;
  });

  // ── Settings ──

  const settingsFile = path.join(paths.stateRoot, "desktop-settings.json");

  function readSettings(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    } catch {
      return {};
    }
  }

  function writeSettings(settings: Record<string, string>): void {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  }

  ipcMain.handle("settings:get", () => {
    const saved = readSettings();
    return {
      baseUrl: saved.baseUrl || process.env["ANTHROPIC_BASE_URL"] || "https://api.anthropic.com",
      apiKey: saved.apiKey || process.env["ANTHROPIC_AUTH_TOKEN"] || "",
      model: saved.model || process.env["ANTHROPIC_MODEL"] || "claude-haiku-4-5",
    };
  });

  ipcMain.handle("settings:set", (_event, settings: Record<string, string>) => {
    const current = readSettings();
    const merged = { ...current, ...settings };
    writeSettings(merged);
    // Apply to process.env so engine picks them up immediately
    if (merged.apiKey) process.env["ANTHROPIC_AUTH_TOKEN"] = merged.apiKey;
    if (merged.baseUrl) process.env["ANTHROPIC_BASE_URL"] = merged.baseUrl;
    if (merged.model) process.env["ANTHROPIC_MODEL"] = merged.model;
    return merged;
  });

  ipcMain.handle("settings:test", async (_event, settings: { baseUrl: string; apiKey: string; model: string }) => {
    try {
      const model = settings.model === "auto" ? "claude-haiku-4-5" : settings.model;
      const res = await fetch(`${settings.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      if (res.ok) {
        return { ok: true, message: "Connected" };
      }
      const body = await res.text();
      return { ok: false, message: `${res.status}: ${body.slice(0, 100)}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // ── App ──

  ipcMain.handle("app:info", () => {
    return {
      version: "0.1.0",
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    };
  });
}

export function unregisterIPC(): void {
  const handlers = [
    "sessions:list", "sessions:create", "sessions:delete", "sessions:rename", "sessions:get",
    "engine:query", "engine:cancel", "engine:status",
    "workspace:get", "workspace:pick", "workspace:set",
    "settings:get", "settings:set", "settings:test",
    "config:get",
    "app:info",
  ];
  for (const h of handlers) {
    ipcMain.removeHandler(h);
  }
}
