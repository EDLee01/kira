import { app, BrowserWindow } from "electron";
import path from "path";
import { registerIPC, unregisterIPC } from "./ipc";
import { startScheduler } from "./scheduler";
import { SessionStore } from "../core/session-store.ts";
import { getMagiPaths } from "../core/paths.ts";
import { MessagesCompatibleAdapter } from "../core/providers/messages-compatible.ts";
import { readDesktopSettings } from "./settings-store";
import { normalizeAnthropicBaseUrl, resolveModelForDesktop } from "./model-discovery";

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
      const settings = readDesktopSettings(paths);
      const apiKey = settings.apiKey || process.env["ANTHROPIC_AUTH_TOKEN"];
      const baseUrl = normalizeAnthropicBaseUrl(settings.baseUrl || process.env["ANTHROPIC_BASE_URL"] || "https://api.anthropic.com");
      const model = resolveModelForDesktop(settings);
      return new MessagesCompatibleAdapter({
        name: "anthropic",
        config: { type: "messages-compatible", format: "anthropic-messages", baseUrl, apiKeyEnv: "ANTHROPIC_AUTH_TOKEN", defaultModel: model },
        env: {
          ...process.env,
          ANTHROPIC_AUTH_TOKEN: apiKey || "",
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_MODEL: model,
        },
      });
    },
    getModel: () => {
      return resolveModelForDesktop(readDesktopSettings(paths));
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
