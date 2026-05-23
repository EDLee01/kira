import { ipcMain, BrowserWindow, dialog } from "electron";
import { Engine } from "./engine";
import { SessionStore } from "../core/session-store.ts";
import { getMagiPaths } from "../core/paths.ts";
import { loadConfig } from "../core/config.ts";
import { executeGoalCommand } from "../core/goal.ts";
import { listCronJobs, applyCronUpdate, deleteCronJob, cronStorePathFromRoot } from "../core/tools/cron.ts";
import { startRemoteServer, stopRemoteServer, isRunning as isRemoteRunning, getToken, getConnectedClients, broadcast } from "./remote-server";
import { startTunnel, stopTunnel, getTunnelUrl, isTunnelRunning } from "./tunnel";
import { applyDesktopSettingsToEnv, readDesktopSettings, writeDesktopSettings } from "./settings-store";
import {
  discoverModels,
  modelDiscoveryFromSettings,
  serializeModelDiscovery,
  testModelConnection,
} from "./model-discovery";
import QRCode from "qrcode";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

export function registerIPC(win: BrowserWindow): void {
  const paths = getMagiPaths(process.env);
  const store = SessionStore.open(paths);
  const engine = new Engine(win, store);

  const readSettings = () => readDesktopSettings(paths);
  const writeSettings = (settings: Record<string, string>) => writeDesktopSettings(paths, settings);
  const normalizeIncomingSettings = (settings: Record<string, unknown>): Record<string, string> => {
    const normalized: Record<string, string> = {};
    for (const key of ["baseUrl", "apiKey", "model", "theme", "workspace"]) {
      const value = settings[key];
      if (typeof value === "string") normalized[key] = value;
    }
    return normalized;
  };

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

  ipcMain.handle("goal:handle", (_event, sessionId: string, text: string) => {
    if (!store.getSession(sessionId)) {
      store.createSession({ id: sessionId, title: text.slice(0, 80), cwd: engine.cwd });
    }
    store.appendMessage({
      sessionId,
      role: "user",
      content: JSON.stringify({ type: "text", text }),
      metadata: { localCommand: "goal" },
    });
    const response = executeGoalCommand(paths, sessionId, text);
    store.appendMessage({
      sessionId,
      role: "assistant",
      content: JSON.stringify([{ type: "text", text: response }]),
      metadata: { localCommand: "goal" },
    });
    return response;
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

  // Restore saved workspace
  const savedSettings = readSettings();
  if (savedSettings.workspace) {
    engine.cwd = savedSettings.workspace;
  }

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
      // Persist
      const s = readSettings();
      s.workspace = result.filePaths[0];
      writeSettings(s);
      return engine.cwd;
    }
    return null;
  });

  ipcMain.handle("workspace:set", (_event, dir: string) => {
    engine.cwd = dir;
    const s = readSettings();
    s.workspace = dir;
    writeSettings(s);
    return engine.cwd;
  });

  // ── Scheduled Tasks ──

  const cronPath = cronStorePathFromRoot(paths.stateRoot);

  ipcMain.handle("tasks:list-scheduled", () => {
    try {
      return listCronJobs(cronPath);
    } catch {
      return [];
    }
  });

  ipcMain.handle("tasks:pause", (_event, id: string) => {
    return applyCronUpdate(cronPath, { id, enabled: false });
  });

  ipcMain.handle("tasks:resume", (_event, id: string) => {
    return applyCronUpdate(cronPath, { id, enabled: true });
  });

  ipcMain.handle("tasks:delete", (_event, id: string) => {
    return deleteCronJob(cronPath, id);
  });

  ipcMain.handle("tasks:history", (_event, cronJobId?: string) => {
    const all = store.listAgentTasks(100);
    if (!cronJobId) return all;
    return all.filter((t: any) => t.metadata?.cronJobId === cronJobId);
  });

  ipcMain.handle("tasks:get-result", (_event, taskId: string) => {
    return store.getAgentTask(taskId);
  });

  // ── Settings ──

  ipcMain.handle("settings:get", () => {
    const saved = readSettings();
    const modelDiscovery = modelDiscoveryFromSettings(saved);
    return {
      baseUrl: saved.baseUrl || process.env["ANTHROPIC_BASE_URL"] || "https://api.anthropic.com",
      apiKey: saved.apiKey || process.env["ANTHROPIC_AUTH_TOKEN"] || "",
      model: saved.model || process.env["ANTHROPIC_MODEL"] || "claude-haiku-4-5",
      theme: saved.theme || "dark",
      availableModels: modelDiscovery.models,
      autoRoutes: modelDiscovery.auto,
      modelsUpdatedAt: modelDiscovery.updatedAt,
    };
  });

  ipcMain.handle("settings:set", (_event, settings: Record<string, unknown>) => {
    const current = readSettings();
    const merged = { ...current, ...normalizeIncomingSettings(settings) };
    writeSettings(merged);
    applyDesktopSettingsToEnv(merged);
    return merged;
  });

  ipcMain.handle("settings:test", async (_event, settings: Record<string, unknown>) => {
    const normalized = normalizeIncomingSettings(settings);
    const current = readSettings();
    const result = await testModelConnection({ ...current, ...normalized });
    const discoveryCache = result.discovery.ok
      ? serializeModelDiscovery(result.discovery)
      : {};
    const merged = { ...current, ...normalized, ...discoveryCache };
    writeSettings(merged);
    applyDesktopSettingsToEnv(merged);
    return result;
  });

  ipcMain.handle("settings:discover-models", async (_event, settings: Record<string, unknown>) => {
    const normalized = normalizeIncomingSettings(settings);
    const current = readSettings();
    const result = await discoverModels({ ...current, ...normalized });
    const discoveryCache = result.ok
      ? serializeModelDiscovery(result)
      : {};
    const merged = { ...current, ...normalized, ...discoveryCache };
    writeSettings(merged);
    applyDesktopSettingsToEnv(merged);
    return result;
  });

  // ── MCP Servers ──

  const mcpFile = path.join(paths.stateRoot, "mcp-servers.json");

  function readMcpServers(): Record<string, any> {
    try { return JSON.parse(fs.readFileSync(mcpFile, "utf-8")); } catch { return {}; }
  }

  function writeMcpServers(servers: Record<string, any>): void {
    fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
    fs.writeFileSync(mcpFile, JSON.stringify(servers, null, 2));
  }

  // Load MCP servers on startup
  engine.mcpServers = readMcpServers();

  ipcMain.handle("mcp:list", () => {
    return readMcpServers();
  });

  ipcMain.handle("mcp:add", (_event, name: string, config: { command: string; args: string[] }) => {
    const servers = readMcpServers();
    servers[name] = { transport: "stdio", command: config.command, args: config.args, env: {}, approval: "never" };
    writeMcpServers(servers);
    engine.mcpServers = servers;
    return servers;
  });

  ipcMain.handle("mcp:remove", (_event, name: string) => {
    const servers = readMcpServers();
    delete servers[name];
    writeMcpServers(servers);
    engine.mcpServers = servers;
    return servers;
  });

  // ── Remote Access ──

  // Forward engine stream events to WebSocket clients
  engine.addListener((event, data) => {
    if (event === "engine:stream-event" && isRemoteRunning()) {
      broadcast(data);
    }
  });

  ipcMain.handle("remote:start", async () => {
    try {
      const port = await startRemoteServer({ store, engine, paths });
      const localIp = getLocalIp();
      const localUrl = `http://${localIp}:${port}?token=${getToken()}`;
      let publicUrl: string | null = null;
      let tunnelError: string | null = null;
      try {
        const tunnelUrl = await startTunnel(port);
        publicUrl = `${tunnelUrl}?token=${getToken()}`;
      } catch (err) {
        tunnelError = (err as Error).message;
        console.error("[remote] Tunnel failed:", tunnelError);
      }
      const accessUrl = publicUrl || localUrl;
      const qrSvg = await QRCode.toString(accessUrl, { type: "svg", width: 160, margin: 1 });
      return { localUrl, publicUrl, token: getToken(), port, qrSvg, accessUrl, tunnelError };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("remote:stop", () => {
    stopTunnel();
    stopRemoteServer();
    return { ok: true };
  });

  ipcMain.handle("remote:status", () => {
    return {
      running: isRemoteRunning(),
      tunnel: isTunnelRunning(),
      publicUrl: getTunnelUrl() ? `${getTunnelUrl()}?token=${getToken()}` : null,
      token: getToken(),
      clients: getConnectedClients(),
    };
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
  stopTunnel();
  stopRemoteServer();
  const handlers = [
    "sessions:list", "sessions:create", "sessions:delete", "sessions:rename", "sessions:get",
    "engine:query", "engine:cancel", "engine:status",
    "workspace:get", "workspace:pick", "workspace:set",
    "tasks:list-scheduled", "tasks:pause", "tasks:resume", "tasks:delete", "tasks:history", "tasks:get-result",
    "settings:get", "settings:set", "settings:test",
    "mcp:list", "mcp:add", "mcp:remove",
    "remote:start", "remote:stop", "remote:status",
    "config:get",
    "app:info",
  ];
  for (const h of handlers) {
    ipcMain.removeHandler(h);
  }
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}
