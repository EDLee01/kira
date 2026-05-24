import { app, BrowserWindow } from "electron";
import path from "path";
import { registerIPC, unregisterIPC } from "./ipc";
import { startScheduler } from "./scheduler";
import { SessionStore } from "../core/session-store.ts";
import { getMagiPaths } from "../core/paths.ts";
import { buildDesktopProvider } from "./desktop-provider";
import { readDesktopSettings, readKiraWorkspaceRoot } from "./settings-store";
import { buildKiraWorkspaceInfo, defaultProjectDir } from "../core/kira-workspace.ts";

let mainWindow: BrowserWindow | null = null;
let stopScheduler: (() => void) | null = null;

function readSchedulerWorkspace(): string {
  const paths = getMagiPaths(process.env);
  const settings = readDesktopSettings(paths);
  const root = readKiraWorkspaceRoot(paths);
  return buildKiraWorkspaceInfo(root, settings.workspace || defaultProjectDir(root)).projectDir;
}

function readSchedulerWorkspaceRoot(): string {
  return readKiraWorkspaceRoot(getMagiPaths(process.env));
}

function createWindow(): void {
  const appIcon = app.isPackaged
    ? path.join(process.resourcesPath, "build", process.platform === "win32" ? "icon.ico" : "icon.png")
    : path.join(__dirname, "..", "..", "build", process.platform === "win32" ? "icon.ico" : "icon.png");
  mainWindow = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: "Kira",
    icon: appIcon,
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
    getProvider: () => buildDesktopProvider(paths),
    getWorkspace: readSchedulerWorkspace,
    getKiraWorkspaceRoot: readSchedulerWorkspaceRoot,
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
