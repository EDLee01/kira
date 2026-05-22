import { app, BrowserWindow } from "electron";
import path from "path";
import { registerIPC, unregisterIPC } from "./ipc";
import { startScheduler } from "./scheduler";
import { SessionStore } from "../core/session-store.ts";
import { getMagiPaths } from "../core/paths.ts";
import { MessagesCompatibleAdapter } from "../core/providers/messages-compatible.ts";

let mainWindow: BrowserWindow | null = null;
let stopScheduler: (() => void) | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: "Kira",
    backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  registerIPC(mainWindow);

  // Start background scheduler
  const paths = getMagiPaths(process.env);
  const store = SessionStore.open(paths);
  stopScheduler = startScheduler({
    store,
    paths,
    win: mainWindow,
    getAdapter: () => {
      const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
      return new MessagesCompatibleAdapter({
        name: "anthropic",
        config: { type: "messages-compatible", format: "anthropic-messages", baseUrl, apiKeyEnv: "ANTHROPIC_AUTH_TOKEN", defaultModel: "claude-haiku-4-5" },
        env: process.env,
      });
    },
    getModel: () => {
      const raw = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5";
      return raw === "auto" ? (process.env["ANTHROPIC_DEFAULT_SONNET_MODEL"] ?? "claude-sonnet-4-6") : raw;
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    unregisterIPC();
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopScheduler?.();
  app.quit();
});
