import { app, BrowserWindow } from "electron";
import path from "path";
import { registerIPC, unregisterIPC } from "./ipc";
import { startScheduler } from "./scheduler";
import { SessionStore } from "../core/session-store.ts";
import { ensureMagiHome, getMagiPaths } from "../core/paths.ts";
import { buildDesktopProvider } from "./desktop-provider";
import { readDesktopSettings, readKiraWorkspaceRoot } from "./settings-store";
import { buildKiraWorkspaceInfo, defaultProjectDir } from "../core/kira-workspace.ts";
import { callComputerUseHelper } from "../core/tools/computer-use-runtime.ts";

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
  const paths = getMagiPaths(process.env);
  ensureMagiHome(paths);
  const appIcon = app.isPackaged
    ? path.join(process.resourcesPath, "build", process.platform === "win32" ? "icon.ico" : "icon.png")
    : path.join(__dirname, "..", "..", "build", process.platform === "win32" ? "icon.ico" : "icon.png");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 560,
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

app.whenReady().then(async () => {
  if (process.env.KIRA_COMPUTER_USE_SMOKE === "1") {
    await runComputerUseSmoke();
    app.quit();
    return;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  stopScheduler?.();
  app.quit();
});

async function runComputerUseSmoke(): Promise<void> {
  const cwd = process.cwd();
  const context = { cwd, env: process.env };
  let cursor: { x: number; y: number } | undefined;

  await reportSmokeStep("permissions", async () => {
    return callComputerUseHelper({
      command: "check_permissions",
      payload: {},
      ...context
    });
  });

  await reportSmokeStep("list_displays", async () => {
    const displays = await callComputerUseHelper<Array<{ displayId?: number; width: number; height: number; scaleFactor?: number }>>({
      command: "list_displays",
      payload: {},
      ...context
    });
    return {
      count: displays.length,
      displays: displays.map((display) => ({
        displayId: display.displayId,
        width: display.width,
        height: display.height,
        scaleFactor: display.scaleFactor
      }))
    };
  });

  await reportSmokeStep("screenshot", async () => {
    const result = await callComputerUseHelper<{ base64: string; width: number; height: number; displayId?: number; backend?: string }>({
      command: "screenshot",
      payload: { targetWidth: 320, targetHeight: 200, jpegQuality: 0.5 },
      ...context
    });
    return {
      width: result.width,
      height: result.height,
      displayId: result.displayId,
      backend: result.backend,
      imageBytes: Buffer.byteLength(result.base64, "base64")
    };
  });

  await reportSmokeStep("cursor_position", async () => {
    cursor = await callComputerUseHelper<{ x: number; y: number }>({
      command: "cursor_position",
      payload: {},
      ...context
    });
    return cursor;
  });

  if (cursor) {
    await reportSmokeStep("native_input_gate", async () => {
      return callComputerUseHelper({
        command: "move_mouse",
        payload: cursor,
        ...context
      });
    });
  }
}

async function reportSmokeStep(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const result = await run();
    console.log(JSON.stringify({ step: name, ok: true, result }));
  } catch (error) {
    console.log(JSON.stringify({
      step: name,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
