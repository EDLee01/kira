import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { NativeImage } from "electron";

type ElectronRuntime = typeof import("electron");

type DisplayGeometry = {
  id: number;
  displayId: number;
  width: number;
  height: number;
  scaleFactor: number;
  originX: number;
  originY: number;
  isPrimary: boolean;
  name: string;
  label: string;
};

type ScreenshotResult = {
  base64: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  displayId: number;
  originX: number;
  originY: number;
  display: DisplayGeometry;
  backend: "electron";
};

type ZoomResult = {
  base64: string;
  width: number;
  height: number;
  backend: "electron";
};

type PixelValidationResult = {
  valid: boolean;
  skipped: boolean;
  warning?: string;
};

type MacNativeComputerUse = {
  isTrustedAccessibilityClient: () => boolean;
  cursorPosition: () => { x: number; y: number };
  moveMouse: (payload: Record<string, unknown>) => boolean;
  click: (payload: Record<string, unknown>) => boolean;
  mouseDown: (payload: Record<string, unknown>) => boolean;
  mouseUp: (payload: Record<string, unknown>) => boolean;
  drag: (payload: Record<string, unknown>) => boolean;
  scroll: (payload: Record<string, unknown>) => boolean;
  key: (payload: Record<string, unknown>) => boolean;
  holdKey: (payload: Record<string, unknown>) => boolean;
  typeText: (payload: Record<string, unknown>) => boolean;
  frontmostApp: () => { bundleId?: string; displayName?: string } | null;
  appUnderPoint: (payload: Record<string, unknown>) => { bundleId?: string; displayName?: string } | null;
  listRunningApps: () => Array<{ bundleId?: string; displayName?: string; path?: string }>;
  listInstalledApps: () => Array<{ bundleId?: string; displayName?: string; path?: string }>;
  openApp: (payload: Record<string, unknown>) => boolean;
  previewHideSet: (payload: Record<string, unknown>) => Array<{ bundleId?: string; displayName?: string }>;
  prepareForAction: (payload: Record<string, unknown>) => string[];
  restoreApps: (payload: Record<string, unknown>) => string[];
  findWindowDisplays: (payload: Record<string, unknown>) => Array<{ bundleId: string; displayIds: number[] }>;
};

const DEFAULT_JPEG_QUALITY = 0.75;
const CLICK_VALIDATION_GRID_SIZE = 9;

export async function callMacComputerUseBridge<T>(
  command: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const electron = await loadElectronRuntime();
  switch (command) {
    case "check_permissions":
      return checkPermissions(electron) as T;
    case "list_displays":
      return listDisplays(electron) as T;
    case "get_display_size":
      return chooseDisplay(electron, readOptionalNumber(payload.displayId)) as T;
    case "screenshot":
      return captureDisplay(electron, payload) as Promise<T>;
    case "zoom":
      return captureRegion(electron, payload) as Promise<T>;
    case "validate_click_target":
      return validateClickTarget(electron, payload) as Promise<T>;
    case "cursor_position":
      return callNativeInput((nativeInput) => nativeInput.cursorPosition()) as T;
    case "move_mouse":
      return callTrustedNativeInput((nativeInput) => nativeInput.moveMouse(payload)) as T;
    case "click":
      return callTrustedNativeInput((nativeInput) => nativeInput.click(payload)) as T;
    case "mouse_down":
      return callTrustedNativeInput((nativeInput) => nativeInput.mouseDown(payload)) as T;
    case "mouse_up":
      return callTrustedNativeInput((nativeInput) => nativeInput.mouseUp(payload)) as T;
    case "drag":
      return callTrustedNativeInput((nativeInput) => nativeInput.drag(payload)) as T;
    case "scroll":
      return callTrustedNativeInput((nativeInput) => nativeInput.scroll(payload)) as T;
    case "key":
      return callTrustedNativeInput((nativeInput) => nativeInput.key(payload)) as T;
    case "hold_key":
      return callTrustedNativeInput((nativeInput) => nativeInput.holdKey(payload)) as T;
    case "type":
      return callTrustedNativeInput((nativeInput) => nativeInput.typeText(payload)) as T;
    case "frontmost_app":
      return callNativeInput((nativeInput) => {
        const app = nativeInput.frontmostApp();
        if (!app?.bundleId && !app?.displayName) {
          throw new Error("macOS native app bridge could not resolve the frontmost app");
        }
        return app;
      }) as T;
    case "app_under_point":
      return callNativeInput((nativeInput) => {
        const app = nativeInput.appUnderPoint(payload);
        if (!app?.bundleId && !app?.displayName) {
          throw new Error("macOS native app bridge could not resolve the app under point");
        }
        return app;
      }) as T;
    case "list_running_apps":
      return callNativeInput((nativeInput) => {
        const apps = nativeInput.listRunningApps();
        if (apps.length === 0) {
          throw new Error("macOS native app bridge returned no running apps");
        }
        return apps;
      }) as T;
    case "list_installed_apps":
      return callNativeInput((nativeInput) => nativeInput.listInstalledApps()) as T;
    case "open_app":
      return callNativeInput((nativeInput) => nativeInput.openApp(payload)) as T;
    case "preview_hide_set":
      return callNativeInput((nativeInput) => {
        ensureNativeRunningAppsAvailable(nativeInput);
        return nativeInput.previewHideSet(payload);
      }) as T;
    case "prepare_for_action":
      return callNativeInput((nativeInput) => {
        ensureNativeRunningAppsAvailable(nativeInput);
        return nativeInput.prepareForAction(payload);
      }) as T;
    case "restore_apps":
      return callNativeInput((nativeInput) => {
        ensureNativeRunningAppsAvailable(nativeInput);
        return nativeInput.restoreApps(payload);
      }) as T;
    case "find_window_displays":
      return callNativeInput((nativeInput) => {
        ensureNativeRunningAppsAvailable(nativeInput);
        return nativeInput.findWindowDisplays(payload);
      }) as T;
    case "read_clipboard":
      return electron.clipboard.readText() as T;
    case "write_clipboard":
      electron.clipboard.writeText(String(payload.text ?? ""));
      return true as T;
    default:
      throw new Error(`macOS in-process Computer Use bridge does not support command: ${command}`);
  }
}

export function isMacComputerUseBridgeCommand(command: string): boolean {
  return command === "check_permissions"
    || command === "list_displays"
    || command === "get_display_size"
    || command === "screenshot"
    || command === "zoom"
    || command === "validate_click_target"
    || command === "cursor_position"
    || command === "move_mouse"
    || command === "click"
    || command === "mouse_down"
    || command === "mouse_up"
    || command === "drag"
    || command === "scroll"
    || command === "key"
    || command === "hold_key"
    || command === "type"
    || command === "frontmost_app"
    || command === "app_under_point"
    || command === "list_running_apps"
    || command === "list_installed_apps"
    || command === "open_app"
    || command === "preview_hide_set"
    || command === "prepare_for_action"
    || command === "restore_apps"
    || command === "find_window_displays"
    || command === "read_clipboard"
    || command === "write_clipboard";
}

export function isMacComputerUseBridgeAvailable(command: string): boolean {
  if (
    !isMacComputerUseBridgeCommand(command)
    || process.platform !== "darwin"
    || !process.versions.electron
  ) {
    return false;
  }
  if (isMacNativeInputCommand(command) && !loadNativeInputModule()) {
    return false;
  }
  return true;
}

async function loadElectronRuntime(): Promise<ElectronRuntime> {
  if (process.platform !== "darwin" || !process.versions.electron) {
    throw new Error("macOS in-process Computer Use bridge is available only inside Electron on macOS");
  }
  return import("electron");
}

function checkPermissions(electron: ElectronRuntime): { accessibility: boolean; screenRecording: boolean | null; backend: "electron" } {
  let screenRecording: boolean | null = null;
  try {
    screenRecording = electron.systemPreferences.getMediaAccessStatus("screen") === "granted";
  } catch {
    screenRecording = null;
  }
  let accessibility = false;
  try {
    accessibility = loadNativeInputModule()?.isTrustedAccessibilityClient()
      ?? electron.systemPreferences.isTrustedAccessibilityClient(false);
  } catch {
    accessibility = false;
  }
  return { accessibility, screenRecording, backend: "electron" };
}

function listDisplays(electron: ElectronRuntime): DisplayGeometry[] {
  const primaryId = electron.screen.getPrimaryDisplay().id;
  return electron.screen.getAllDisplays().map((display, index) => {
    const width = Math.round(display.bounds.width);
    const height = Math.round(display.bounds.height);
    const label = display.label || `Display ${index + 1}`;
    return {
      id: display.id,
      displayId: display.id,
      width,
      height,
      scaleFactor: display.scaleFactor || 1,
      originX: Math.round(display.bounds.x),
      originY: Math.round(display.bounds.y),
      isPrimary: display.id === primaryId,
      name: label,
      label
    };
  });
}

function chooseDisplay(electron: ElectronRuntime, displayId: number | undefined): DisplayGeometry {
  const displays = listDisplays(electron);
  if (displays.length === 0) {
    throw new Error("No active displays found");
  }
  if (displayId === undefined) {
    return displays.find((display) => display.isPrimary) ?? displays[0];
  }
  const display = displays.find((item) => item.displayId === displayId || item.id === displayId);
  if (!display) {
    throw new Error(`Unknown display: ${displayId}`);
  }
  return display;
}

async function captureDisplay(electron: ElectronRuntime, payload: Record<string, unknown>): Promise<ScreenshotResult> {
  const display = chooseDisplay(electron, readOptionalNumber(payload.displayId));
  const targetWidth = readOptionalNumber(payload.targetWidth);
  const targetHeight = readOptionalNumber(payload.targetHeight);
  const thumbnail = await captureDisplayImage(electron, display);
  const resized = resizeImage(thumbnail, targetWidth, targetHeight);
  return {
    base64: encodeJpeg(resized, readJpegQuality(payload.jpegQuality)),
    width: resized.getSize().width,
    height: resized.getSize().height,
    displayWidth: display.width,
    displayHeight: display.height,
    displayId: display.displayId,
    originX: display.originX,
    originY: display.originY,
    display,
    backend: "electron"
  };
}

async function captureRegion(electron: ElectronRuntime, payload: Record<string, unknown>): Promise<ZoomResult> {
  const x = readRequiredInteger(payload.x, "x");
  const y = readRequiredInteger(payload.y, "y");
  const width = readRequiredInteger(payload.width, "width");
  const height = readRequiredInteger(payload.height, "height");
  const display = chooseDisplayForRect(electron, x, y, width, height);
  const thumbnail = await captureDisplayImage(electron, display);
  const imageSize = thumbnail.getSize();
  const scaleX = imageSize.width / display.width;
  const scaleY = imageSize.height / display.height;
  const localX = Math.max(0, x - display.originX);
  const localY = Math.max(0, y - display.originY);
  const cropX = Math.round(localX * scaleX);
  const cropY = Math.round(localY * scaleY);
  const cropRect = {
    x: cropX,
    y: cropY,
    width: Math.max(1, Math.min(Math.round(width * scaleX), imageSize.width - cropX)),
    height: Math.max(1, Math.min(Math.round(height * scaleY), imageSize.height - cropY))
  };
  const targetWidth = readOptionalNumber(payload.targetWidth);
  const targetHeight = readOptionalNumber(payload.targetHeight);
  const cropped = thumbnail.crop(cropRect);
  const resized = resizeImage(cropped, targetWidth, targetHeight);
  return {
    base64: encodeJpeg(resized, readJpegQuality(payload.jpegQuality)),
    width: resized.getSize().width,
    height: resized.getSize().height,
    backend: "electron"
  };
}

async function validateClickTarget(
  electron: ElectronRuntime,
  payload: Record<string, unknown>
): Promise<PixelValidationResult> {
  const lastBase64 = typeof payload.lastScreenshotBase64 === "string" ? payload.lastScreenshotBase64 : "";
  const targetWidth = readOptionalNumber(payload.targetWidth);
  const targetHeight = readOptionalNumber(payload.targetHeight);
  if (!lastBase64 || !targetWidth || !targetHeight) {
    return { valid: true, skipped: true };
  }
  const xPercent = typeof payload.xPercent === "number" && Number.isFinite(payload.xPercent) ? payload.xPercent : 0;
  const yPercent = typeof payload.yPercent === "number" && Number.isFinite(payload.yPercent) ? payload.yPercent : 0;
  const gridSize = readOptionalNumber(payload.gridSize) ?? CLICK_VALIDATION_GRID_SIZE;
  const fresh = await captureDisplay(electron, {
    displayId: readOptionalNumber(payload.displayId),
    targetWidth,
    targetHeight,
    jpegQuality: DEFAULT_JPEG_QUALITY
  });
  const lastImage = electron.nativeImage.createFromBuffer(Buffer.from(lastBase64, "base64")).resize({
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(targetHeight)),
    quality: "best"
  });
  const freshImage = electron.nativeImage.createFromBuffer(Buffer.from(fresh.base64, "base64")).resize({
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(targetHeight)),
    quality: "best"
  });
  const lastPatch = cropPatchBytes(lastImage, xPercent, yPercent, Math.round(gridSize));
  const freshPatch = cropPatchBytes(freshImage, xPercent, yPercent, Math.round(gridSize));
  if (!lastPatch || !freshPatch) {
    return { valid: true, skipped: true };
  }
  if (lastPatch.equals(freshPatch)) {
    return { valid: true, skipped: false };
  }
  return {
    valid: false,
    skipped: false,
    warning: "Screen content at the target location changed since the last screenshot. Take a new screenshot before clicking."
  };
}

function cropPatchBytes(image: NativeImage, xPercent: number, yPercent: number, gridSize: number): Buffer | undefined {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) return undefined;
  const safeGridSize = Math.max(1, gridSize);
  const centerX = Math.round((Math.max(0, Math.min(100, xPercent)) / 100) * size.width);
  const centerY = Math.round((Math.max(0, Math.min(100, yPercent)) / 100) * size.height);
  const half = Math.floor(safeGridSize / 2);
  const x = Math.max(0, centerX - half);
  const y = Math.max(0, centerY - half);
  const width = Math.min(safeGridSize, size.width - x);
  const height = Math.min(safeGridSize, size.height - y);
  if (width <= 0 || height <= 0) return undefined;
  return image.crop({ x, y, width, height }).toBitmap();
}

async function captureDisplayImage(electron: ElectronRuntime, display: DisplayGeometry): Promise<NativeImage> {
  const displayIndex = listDisplays(electron).findIndex((item) => item.displayId === display.displayId);
  const physicalWidth = Math.max(1, Math.round(display.width * display.scaleFactor));
  const physicalHeight = Math.max(1, Math.round(display.height * display.scaleFactor));
  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await electron.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: physicalWidth,
        height: physicalHeight
      },
      fetchWindowIcons: false
    });
  } catch (error) {
    throw new Error(formatDesktopCaptureError(error));
  }
  const source = sources.find((item) => item.display_id === String(display.displayId))
    ?? sources.find((item) => item.id === `screen:${display.displayId}:0`)
    ?? sources.find((item) => item.name === display.label || item.name === display.name)
    ?? (displayIndex >= 0 ? sources[displayIndex] : undefined)
    ?? (display.isPrimary ? sources[0] : undefined);
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(`Unable to capture display ${display.displayId}`);
  }
  const image = source.thumbnail;
  const size = image.getSize();
  if (size.width === physicalWidth && size.height === physicalHeight) {
    return image;
  }
  return image.resize({ width: physicalWidth, height: physicalHeight, quality: "best" });
}

function formatDesktopCaptureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to get sources/i.test(message)) {
    return [
      "Electron desktop capture failed: Failed to get sources.",
      "macOS Screen Recording may not be active for this exact Kira.app instance yet.",
      "Quit and reopen Kira from /Applications, then retry. If it still fails, remove Kira from System Settings > Privacy & Security > Screen Recording, add /Applications/Kira.app again, enable it, and restart Kira."
    ].join(" ");
  }
  return `Electron desktop capture failed: ${message}`;
}

function chooseDisplayForRect(electron: ElectronRuntime, x: number, y: number, width: number, height: number): DisplayGeometry {
  const displays = listDisplays(electron);
  const display = displays.find((item) =>
    x >= item.originX
    && y >= item.originY
    && x < item.originX + item.width
    && y < item.originY + item.height
  );
  if (display) return display;
  const centerX = x + Math.round(width / 2);
  const centerY = y + Math.round(height / 2);
  return displays.find((item) =>
    centerX >= item.originX
    && centerY >= item.originY
    && centerX < item.originX + item.width
    && centerY < item.originY + item.height
  ) ?? chooseDisplay(electron, undefined);
}

function resizeImage(image: NativeImage, width: number | undefined, height: number | undefined): NativeImage {
  if (!width || !height) return image;
  return image.resize({
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    quality: "best"
  });
}

function encodeJpeg(image: NativeImage, quality: number): string {
  return image.toJPEG(Math.max(1, Math.min(100, Math.round(quality * 100)))).toString("base64");
}

function readJpegQuality(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_JPEG_QUALITY;
  }
  if (value > 1) {
    return Math.max(0.01, Math.min(1, value / 100));
  }
  return Math.max(0.01, Math.min(1, value));
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRequiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`macOS Computer Use bridge requires numeric ${name}`);
  }
  return Math.round(value);
}

function isMacNativeInputCommand(command: string): boolean {
  return command === "cursor_position"
    || command === "move_mouse"
    || command === "click"
    || command === "mouse_down"
    || command === "mouse_up"
    || command === "drag"
    || command === "scroll"
    || command === "key"
    || command === "hold_key"
    || command === "type"
    || command === "frontmost_app"
    || command === "app_under_point"
    || command === "list_running_apps"
    || command === "list_installed_apps"
    || command === "open_app"
    || command === "preview_hide_set"
    || command === "prepare_for_action"
    || command === "restore_apps"
    || command === "find_window_displays";
}

function callNativeInput<T>(callback: (nativeInput: MacNativeComputerUse) => T): T {
  const nativeInput = loadNativeInputModule();
  if (!nativeInput) {
    throw new Error("macOS native Computer Use input module is not built");
  }
  return callback(nativeInput);
}

function callTrustedNativeInput<T>(callback: (nativeInput: MacNativeComputerUse) => T): T {
  return callNativeInput((nativeInput) => {
    if (!nativeInput.isTrustedAccessibilityClient()) {
      throw new Error("Kira does not have macOS Accessibility access. Enable Kira in System Settings > Privacy & Security > Accessibility, restart Kira if macOS requests it, then retry.");
    }
    return callback(nativeInput);
  });
}

function ensureNativeRunningAppsAvailable(nativeInput: MacNativeComputerUse): void {
  if (nativeInput.listRunningApps().length === 0) {
    throw new Error("macOS native app bridge returned no running apps");
  }
}

let nativeInputModule: MacNativeComputerUse | null | undefined;

function loadNativeInputModule(): MacNativeComputerUse | undefined {
  if (process.platform !== "darwin") return undefined;
  if (nativeInputModule !== undefined) return nativeInputModule ?? undefined;
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const candidates = nativeInputCandidates();
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      nativeInputModule = require(candidate) as MacNativeComputerUse;
      return nativeInputModule;
    } catch {
      // Try the next packaged/development location.
    }
  }
  nativeInputModule = null;
  return undefined;
}

function nativeInputCandidates(): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [
    resourcesPath ? path.join(resourcesPath, "native", "mac-computer-use", "kira_mac_computer_use.node") : undefined,
    path.join(process.cwd(), "native", "mac-computer-use", "build", "Release", "kira_mac_computer_use.node"),
    path.join(process.cwd(), "dist", "native", "mac-computer-use", "kira_mac_computer_use.node")
  ].filter((item): item is string => Boolean(item));
}
