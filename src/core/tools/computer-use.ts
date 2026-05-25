import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { ToolError } from "./errors.ts";
import { callComputerUseHelper } from "./computer-use-runtime.ts";
import {
  acquireComputerUseLock,
  checkComputerUseLock,
  releaseComputerUseLock
} from "./computer-use-lock.ts";
import { isSystemComputerUseKeyCombo } from "./computer-use-keys.ts";
import type { ComputerUseActionKind } from "./computer-use-policy.ts";
import {
  buildComputerUsePolicyDeniedGuidance,
  buildComputerUseTierGuidance,
  evaluateComputerUseAppPolicy,
  formatComputerUseApp,
  getComputerUseAppCategory,
  getDefaultComputerUseTier
} from "./computer-use-policy.ts";

export type ComputerUseAction =
  | "screenshot"
  | "zoom"
  | "display_info"
  | "switch_display"
  | "permissions"
  | "cursor_position"
  | "frontmost_app"
  | "app_under_point"
  | "request_access"
  | "request_teach_access"
  | "list_granted_apps"
  | "list_running_apps"
  | "list_installed_apps"
  | "open_app"
  | "click"
  | "double_click"
  | "triple_click"
  | "right_click"
  | "middle_click"
  | "move"
  | "drag"
  | "left_mouse_down"
  | "left_mouse_up"
  | "scroll"
  | "type"
  | "key"
  | "hold_key"
  | "hotkey"
  | "read_clipboard"
  | "write_clipboard"
  | "wait"
  | "batch"
  | "teach_step"
  | "teach_batch";

type ComputerUseActionAlias =
  | "left_click"
  | "mouse_move"
  | "left_click_drag"
  | "open_application"
  | "list_granted_applications"
  | "computer_batch";

export type ComputerUseBatchAction = Exclude<ComputerUseAction, "batch" | "teach_step" | "teach_batch" | "zoom" | "display_info" | "switch_display" | "permissions" | "request_access" | "request_teach_access" | "list_granted_apps" | "list_running_apps" | "list_installed_apps" | "open_app" | "hotkey" | "read_clipboard" | "write_clipboard">;

const COMPUTER_USE_BATCH_ACTIONS = [
  "key",
  "type",
  "mouse_move",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "hold_key",
  "screenshot",
  "cursor_position",
  "left_mouse_down",
  "left_mouse_up",
  "wait"
] as const;

const NORMALIZED_COMPUTER_USE_BATCH_ACTIONS = new Set<ComputerUseBatchAction>([
  "key",
  "type",
  "move",
  "click",
  "drag",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "hold_key",
  "screenshot",
  "cursor_position",
  "left_mouse_down",
  "left_mouse_up",
  "wait"
]);

export interface ComputerUseBatchItem {
  action: ComputerUseBatchAction;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  width?: number;
  height?: number;
  deltaX?: number;
  deltaY?: number;
  text?: string;
  key?: string;
  keys?: string[];
  app?: string;
  display?: string;
  bundleId?: string;
  durationMs?: number;
  repeat?: number;
  viaClipboard?: boolean;
}

export interface ComputerUseTeachStep {
  explanation: string;
  nextPreview: string;
  anchor?: [number, number];
  actions: ComputerUseBatchItem[];
}

export interface ComputerUseInput {
  action: ComputerUseAction;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  width?: number;
  height?: number;
  deltaX?: number;
  deltaY?: number;
  text?: string;
  key?: string;
  keys?: string[];
  app?: string;
  bundleId?: string;
  apps?: string[];
  reason?: string;
  clipboardRead?: boolean;
  clipboardWrite?: boolean;
  systemKeyCombos?: boolean;
  display?: string;
  displayId?: number;
  includeImage?: boolean;
  viaClipboard?: boolean;
  includePostActionScreenshot?: boolean;
  durationMs?: number;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  region?: [number, number, number, number];
  repeat?: number;
  scroll_direction?: string;
  scroll_amount?: number;
  save_to_disk?: boolean;
  actions?: ComputerUseBatchItem[];
  explanation?: string;
  nextPreview?: string;
  next_preview?: string;
  anchor?: [number, number];
  steps?: ComputerUseTeachStep[];
}

interface DisplayGeometry {
  id?: number;
  displayId?: number;
  width: number;
  height: number;
  scaleFactor: number;
  originX: number;
  originY: number;
  isPrimary?: boolean;
  name?: string;
  label?: string;
}

interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  displayId?: number;
  originX?: number;
  originY?: number;
  display?: DisplayGeometry;
  monitorNote?: string;
  filePath?: string;
}

interface ZoomResult {
  base64: string;
  width: number;
  height: number;
}

type Point = { x: number; y: number };

export interface ComputerUseAppInfo {
  bundleId?: string;
  displayName?: string;
}

export interface ComputerUseAppGrant extends ComputerUseAppInfo {
  tier?: "read" | "click" | "full";
  grantedAt: string;
}

export interface ComputerUseGrantFlags {
  clipboardRead: boolean;
  clipboardWrite: boolean;
  systemKeyCombos: boolean;
}

export interface ComputerUseAccessDenial {
  bundleId: string;
  reason: "user_denied" | "not_installed";
}

export interface ComputerUseApprovalResponse {
  granted?: ComputerUseAppGrant[];
  denied?: ComputerUseAccessDenial[];
  grantedApps?: string[];
  deniedApps?: string[];
  flags?: Partial<ComputerUseGrantFlags>;
  userConsented?: boolean;
}

export interface ComputerUseApprovalPreview {
  willHide: ComputerUseAppInfo[];
  autoUnhideEnabled: boolean;
}

type AppInfo = ComputerUseAppInfo;
type AppGrant = ComputerUseAppGrant;

interface PolicyCheckResult {
  app?: AppInfo;
  note?: string;
  tier?: AppGrant["tier"];
}

interface PolicyGateResult {
  app?: AppInfo;
  note?: string;
  tier?: AppGrant["tier"];
  role: "target" | "frontmost" | "point";
}

interface PixelValidationResult {
  valid: boolean;
  skipped: boolean;
  warning?: string;
}

interface PolicyDeniedRequest {
  requestedName: string;
  displayName: string;
  reason: string;
}

interface ComputerUseExecutionOptions {
  skipHostWindowHide?: boolean;
  skipDesktopPrepare?: boolean;
  skipClickFreshness?: boolean;
}

interface ComputerUseBatchActionResult {
  action: string;
  ok: boolean;
  output: string;
}

export interface ComputerUseTeachStepRequest {
  explanation: string;
  nextPreview: string;
  anchor?: Point;
  actionCount: number;
  stepIndex?: number;
  stepCount?: number;
}

export type ComputerUseTeachStepResult = { action: "next" } | { action: "exit" };
export type ComputerUseTeachStepResolver = (request: ComputerUseTeachStepRequest) => Promise<ComputerUseTeachStepResult> | ComputerUseTeachStepResult;

export type ComputerUseContext = {
  cwd: string;
  kiraWorkspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  sessionId?: string;
  signal?: AbortSignal;
  deniedBundleIds?: string[];
  approvalResponse?: ComputerUseApprovalResponse;
  teachStepResolver?: ComputerUseTeachStepResolver;
  hideHostWindow?: () => Promise<void> | void;
  teachModeActivated?: () => Promise<void> | void;
  teachModeExited?: () => Promise<void> | void;
};

const grantsBySession = new Map<string, Map<string, AppGrant>>();
const grantFlagsBySession = new Map<string, ComputerUseGrantFlags>();
const selectedDisplaysBySession = new Map<string, number>();
const displayPinnedBySession = new Set<string>();
const displayResolvedForAppsBySession = new Map<string, string>();
const mouseHoldStateBySession = new Map<string, { held: boolean; moved: boolean }>();
const teachModeBySession = new Map<string, boolean>();
const hiddenAppsBySession = new Map<string, Map<string, AppInfo>>();
const hiddenSinceLastScreenshotBySession = new Map<string, string[]>();
const clipboardStashBySession = new Map<string, string>();

const FINDER_BUNDLE_ID = "com.apple.finder";
const SAFARI_BUNDLE_ID = "com.apple.safari";
const WINDOWS_EXPLORER_BUNDLE_ID = "explorer.exe";
const TIER_ANTI_SUBVERSION = " Do not try to bypass this restriction through shortcuts, shell commands, scripts, automation APIs, or another tool.";
const FAST_APP_LIST_TIMEOUT_MS = 3500;
const INTER_GRAPHEME_SLEEP_MS = 8;
const MOVE_SETTLE_MS = 50;
const SCREENSHOT_JPEG_QUALITY = 0.75;
const MIN_SCREENSHOT_BYTES = 1024;
const API_RESIZE_PARAMS = {
  pxPerToken: 28,
  maxTargetPx: 1568,
  maxTargetTokens: 1568
};

const screenshotsBySession = new Map<string, ScreenshotResult>();

export const ComputerUseInputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "screenshot",
        "zoom",
        "display_info",
        "switch_display",
        "permissions",
        "cursor_position",
        "frontmost_app",
        "app_under_point",
        "request_access",
        "request_teach_access",
        "list_granted_apps",
        "list_running_apps",
        "list_installed_apps",
        "open_app",
        "click",
        "double_click",
        "triple_click",
        "right_click",
        "middle_click",
        "move",
        "drag",
        "left_mouse_down",
        "left_mouse_up",
        "scroll",
        "type",
        "key",
        "hold_key",
        "hotkey",
        "read_clipboard",
        "write_clipboard",
        "wait",
        "batch",
        "computer_batch",
        "teach_step",
        "teach_batch",
        "left_click",
        "mouse_move",
        "left_click_drag",
        "open_application",
        "list_granted_applications"
      ],
      description: "Desktop action to perform. Use screenshot first to inspect the visible desktop. Magi-compatible action aliases are accepted: left_click, mouse_move, left_click_drag, open_application, list_granted_applications, computer_batch."
    },
    x: { type: "number", description: "Horizontal pixel position read directly from the most recent screenshot image, measured from the left edge. Kira handles all scaling." },
    y: { type: "number", description: "Vertical pixel position read directly from the most recent screenshot image, measured from the top edge. Kira handles all scaling." },
    toX: { type: "number", description: "Destination horizontal pixel position read directly from the most recent screenshot image. Kira handles all scaling." },
    toY: { type: "number", description: "Destination vertical pixel position read directly from the most recent screenshot image. Kira handles all scaling." },
    width: { type: "number", description: "Region width in pixels from the most recent screenshot image, for zoom." },
    height: { type: "number", description: "Region height in pixels from the most recent screenshot image, for zoom." },
    deltaX: { type: "number", description: "Horizontal scroll delta." },
    deltaY: { type: "number", description: "Vertical scroll delta." },
    coordinate: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" },
      description: "Magi-compatible [x, y] coordinate tuple. Equivalent to x/y; for left_click_drag this is the end coordinate."
    },
    start_coordinate: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" },
      description: "Magi-compatible [x, y] start coordinate for left_click_drag."
    },
    region: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "number" },
      description: "Magi-compatible zoom region [x0, y0, x1, y1] in the latest screenshot image pixels."
    },
    text: { type: "string", description: "Text to type for the type action." },
    key: { type: "string", description: "Key name or sequence for key, e.g. enter, escape, tab, command+space." },
    keys: {
      type: "array",
      items: { type: "string" },
      description: "Keys for a hotkey action, e.g. ['command','space'] or ['command','shift','4']."
    },
    app: { type: "string", description: "For open_app, an app display name or bundle ID already granted by request_access." },
    bundleId: { type: "string", description: "For open_app, an app bundle identifier or stable app ID already granted by request_access." },
    apps: {
      type: "array",
      items: { type: "string" },
      description: "For request_access, app display names or bundle IDs to grant for this session."
    },
    reason: {
      type: "string",
      description: "For request_access or request_teach_access, one sentence explaining why Kira needs desktop control for these apps."
    },
    clipboardRead: {
      type: "boolean",
      description: "For request_access, also request permission to read clipboard text."
    },
    clipboardWrite: {
      type: "boolean",
      description: "For request_access, also request permission to write clipboard text and use clipboard paste for reliable typing."
    },
    systemKeyCombos: {
      type: "boolean",
      description: "For request_access, also request permission to send system-level key combos such as app switching, quit, lock, or OS shortcuts."
    },
    display: { type: "string", description: "For switch_display, monitor label/name/ID from display_info or screenshot note, or 'auto' to return to the primary display." },
    displayId: { type: "number", description: "Optional display identifier for screenshot/display_info/switch_display. If omitted, Kira uses the display selected by switch_display." },
    includeImage: {
      type: "boolean",
      description: "For screenshot, include a base64 image in the tool result. Defaults to true."
    },
    viaClipboard: {
      type: "boolean",
      description: "For type, force clipboard paste when true. If omitted, Kira uses the clipboard only when clipboardWrite was granted and paste is the more reliable path for the current platform/text."
    },
    includePostActionScreenshot: {
      type: "boolean",
      description: "For controlling actions, include a fresh screenshot after the action. Defaults to false. Teach steps return their own final screenshot when actions run."
    },
    durationMs: {
      type: "number",
      description: "Milliseconds to wait for the wait action. Maximum 100000."
    },
    duration: {
      type: "number",
      description: "Magi-compatible duration in seconds for wait or hold_key. Kira converts this to durationMs."
    },
    repeat: {
      type: "number",
      description: "Magi-compatible repeat count for key actions."
    },
    scroll_direction: {
      type: "string",
      enum: ["up", "down", "left", "right"],
      description: "Magi-compatible scroll direction."
    },
    scroll_amount: {
      type: "number",
      description: "Magi-compatible scroll tick amount."
    },
    save_to_disk: {
      type: "boolean",
      description: "Magi-compatible screenshot flag. Save the image to disk only when you intend to share the saved path with the user."
    },
    actions: {
      type: "array",
      description: "For batch or teach_step, a sequence of desktop actions. Coordinates are pixels from the same pre-batch screenshot image. Mid-batch screenshot actions are allowed for inspection; later coordinates still refer to the pre-batch screenshot.",
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: COMPUTER_USE_BATCH_ACTIONS
          },
          x: { type: "number" },
          y: { type: "number" },
          toX: { type: "number" },
          toY: { type: "number" },
          coordinate: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          start_coordinate: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          deltaX: { type: "number" },
          deltaY: { type: "number" },
          scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
          scroll_amount: { type: "number" },
          text: { type: "string" },
          key: { type: "string" },
          keys: { type: "array", items: { type: "string" } },
          app: { type: "string" },
          bundleId: { type: "string" },
          durationMs: { type: "number" },
          duration: { type: "number" },
          viaClipboard: { type: "boolean" }
        },
        required: ["action"],
        additionalProperties: false
      }
    },
    explanation: {
      type: "string",
      description: "For teach_step: tooltip body text shown to the user."
    },
    nextPreview: {
      type: "string",
      description: "For teach_step: one line explaining what Kira will do when the user chooses Next."
    },
    next_preview: {
      type: "string",
      description: "Alias for nextPreview, matching Magi teach_step."
    },
    anchor: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" },
      description: "For teach_step: optional [x, y] tooltip anchor in latest screenshot image pixels."
    },
    steps: {
      type: "array",
      description: "For teach_batch: ordered teach steps. Each step has explanation, next_preview/nextPreview, optional anchor, and actions.",
      items: {
        type: "object",
        properties: {
          explanation: { type: "string" },
          nextPreview: { type: "string" },
          next_preview: { type: "string" },
          anchor: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "number" }
          },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: COMPUTER_USE_BATCH_ACTIONS
                },
                x: { type: "number" },
                y: { type: "number" },
                toX: { type: "number" },
                toY: { type: "number" },
                coordinate: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
                start_coordinate: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
                deltaX: { type: "number" },
                deltaY: { type: "number" },
                scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
                scroll_amount: { type: "number" },
                text: { type: "string" },
                key: { type: "string" },
                keys: { type: "array", items: { type: "string" } },
                app: { type: "string" },
                bundleId: { type: "string" },
                durationMs: { type: "number" },
                duration: { type: "number" },
                repeat: { type: "number" },
                viaClipboard: { type: "boolean" }
              },
              required: ["action"],
              additionalProperties: false
            }
          }
        },
        required: ["explanation", "actions"],
        additionalProperties: false
      }
    }
  },
  required: ["action"],
  additionalProperties: false
} satisfies Record<string, unknown>;

export function parseComputerUseInput(input: Record<string, unknown>): ComputerUseInput {
  if (!isComputerUseRawAction(input.action)) {
    throw new ToolError(`ComputerUse action is unsupported: ${String(input.action)}`, "bad-input");
  }
  const normalizedInput = normalizeComputerUseInputShape(input);
  const action = normalizedInput.action;
  if (!isComputerUseAction(action)) {
    throw new ToolError(`ComputerUse action is unsupported: ${String(action)}`, "bad-input");
  }
  const parsed: ComputerUseInput = {
    action,
    x: readOptionalNumber(normalizedInput, "x"),
    y: readOptionalNumber(normalizedInput, "y"),
    toX: readOptionalNumber(normalizedInput, "toX"),
    toY: readOptionalNumber(normalizedInput, "toY"),
    width: readOptionalNumber(normalizedInput, "width"),
    height: readOptionalNumber(normalizedInput, "height"),
    deltaX: readOptionalNumber(normalizedInput, "deltaX"),
    deltaY: readOptionalNumber(normalizedInput, "deltaY"),
    text: readOptionalString(normalizedInput, "text"),
    key: readOptionalString(normalizedInput, "key"),
    keys: readOptionalStringArray(normalizedInput, "keys"),
    app: readOptionalString(normalizedInput, "app"),
    display: readOptionalString(normalizedInput, "display"),
    bundleId: readOptionalString(normalizedInput, "bundleId"),
    apps: readOptionalStringArray(normalizedInput, "apps"),
    reason: readOptionalString(normalizedInput, "reason"),
    clipboardRead: readOptionalBoolean(normalizedInput, "clipboardRead"),
    clipboardWrite: readOptionalBoolean(normalizedInput, "clipboardWrite"),
    systemKeyCombos: readOptionalBoolean(normalizedInput, "systemKeyCombos"),
    displayId: readOptionalNumber(normalizedInput, "displayId"),
    includeImage: readOptionalBoolean(normalizedInput, "includeImage"),
    viaClipboard: readOptionalBoolean(normalizedInput, "viaClipboard"),
    includePostActionScreenshot: readOptionalBoolean(normalizedInput, "includePostActionScreenshot"),
    durationMs: readOptionalNumber(normalizedInput, "durationMs"),
    repeat: readOptionalNumber(normalizedInput, "repeat"),
    actions: readOptionalBatchActions(normalizedInput, "actions"),
    explanation: readOptionalString(normalizedInput, "explanation"),
    nextPreview: readOptionalString(normalizedInput, "nextPreview"),
    next_preview: readOptionalString(normalizedInput, "next_preview"),
    anchor: readOptionalAnchor(normalizedInput, "anchor"),
    steps: readOptionalTeachSteps(normalizedInput, "steps")
  };
  validateComputerUseInput(parsed);
  return parsed;
}

export async function executeComputerUse(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  if (os.platform() !== "darwin" && os.platform() !== "win32") {
    throw new ToolError(`ComputerUse supports macOS and Windows only; current platform is ${os.platform()}`, "command-failed");
  }

  try {
    await gateComputerUseLock(input, context);
    return await executeComputerUseUnlocked(input, context);
  } catch (error) {
    throw asComputerUseError(error, input.action);
  }
}

export function formatComputerUseResult(result: string): string {
  return result;
}

export function resetComputerUseTurnState(context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId">): void {
  const key = computerUseSessionKey(context);
  teachModeBySession.delete(key);
  mouseHoldStateBySession.delete(key);
  hiddenAppsBySession.delete(key);
  hiddenSinceLastScreenshotBySession.delete(key);
  clipboardStashBySession.delete(key);
}

export async function restoreComputerUseHiddenApps(context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId" | "env" | "signal">): Promise<void> {
  const key = computerUseSessionKey(context);
  const hidden = [...(hiddenAppsBySession.get(key)?.keys() ?? [])];
  if (hidden.length === 0) return;
  try {
    await helper("restore_apps", { bundleIds: hidden }, context);
  } catch {
    // Best effort cleanup: restoring windows must never mask the agent result.
  }
}

export async function restoreComputerUseClipboard(context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId" | "env" | "signal">): Promise<void> {
  await restoreClipboardStash(context);
}

export async function releaseComputerUseSession(context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId">): Promise<void> {
  await releaseComputerUseLock(context);
}

export function isComputerUseReadOnlyAction(action: unknown): boolean {
  return action === "screenshot"
    || action === "zoom"
    || action === "display_info"
    || action === "switch_display"
    || action === "permissions"
    || action === "cursor_position"
    || action === "frontmost_app"
    || action === "app_under_point"
    || action === "list_granted_apps"
    || action === "list_running_apps"
    || action === "list_installed_apps";
}

export function getComputerUseSessionState(
  context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId">
): { grants: ComputerUseAppGrant[]; flags: ComputerUseGrantFlags } {
  return {
    grants: [...grantStore(context).values()],
    flags: { ...grantFlags(context) }
  };
}

export async function previewComputerUseApproval(
  rawInput: Record<string, unknown>,
  context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId" | "env" | "signal">
): Promise<ComputerUseApprovalPreview | undefined> {
  let input: ComputerUseInput;
  try {
    input = parseComputerUseInput(rawInput);
  } catch {
    return undefined;
  }
  if (input.action !== "request_access" && input.action !== "request_teach_access") return undefined;
  const requested = input.apps ?? [];
  if (requested.length === 0) return undefined;

  const runtimeContext = context as ComputerUseContext;
  const running = await helper<AppInfo[]>("list_running_apps", {}, runtimeContext, { timeoutMs: FAST_APP_LIST_TIMEOUT_MS })
    .catch(() => [] as AppInfo[]);
  const requestedBundleIds = requested.flatMap((name) => {
    const app = resolveRequestedApp(name, running);
    if (!app) return [];
    const policy = evaluateComputerUseAppPolicy(app, "mouse_position");
    if (!policy.allowed || policy.category === "policy_denied") return [];
    return app.bundleId ? [app.bundleId] : [];
  });
  const existingGrants = grantsBySession.get(computerUseSessionKey(runtimeContext));
  const alreadyGrantedBundleIds = [...(existingGrants?.values() ?? [])]
    .map((grant) => grant.bundleId)
    .filter((bundleId): bundleId is string => Boolean(bundleId));
  const exemptBundleIds = [...new Set([...alreadyGrantedBundleIds, ...requestedBundleIds])];
  if (exemptBundleIds.length === 0) return undefined;

  const willHide = await helper<AppInfo[]>("preview_hide_set", {
    exemptBundleIds,
    displayId: effectiveDisplayId({ action: "screenshot" }, runtimeContext)
  }, runtimeContext, { timeoutMs: FAST_APP_LIST_TIMEOUT_MS }).catch(() => [] as AppInfo[]);
  if (willHide.length === 0) return undefined;
  return { willHide, autoUnhideEnabled: true };
}

async function takeScreenshot(
  input: ComputerUseInput,
  context: ComputerUseContext,
  options: ComputerUseExecutionOptions = {}
): Promise<ScreenshotResult> {
  requireComputerUseAllowlist(context);
  const previousScreenshot = getLastScreenshot(context);
  const displayId = await resolveScreenshotDisplayId(input, context);
  if (!options.skipDesktopPrepare) {
    await prepareDesktopForAction(context, displayId);
  }
  const display = await helper<DisplayGeometry>("get_display_size", { displayId }, context);
  const physicalWidth = Math.round(display.width * display.scaleFactor);
  const physicalHeight = Math.round(display.height * display.scaleFactor);
  const [targetWidth, targetHeight] = targetImageSize(physicalWidth, physicalHeight, API_RESIZE_PARAMS);
  let screenshot = await helper<ScreenshotResult>("screenshot", {
    displayId,
    targetWidth,
    targetHeight,
    jpegQuality: SCREENSHOT_JPEG_QUALITY
  }, context);
  if (decodedByteLength(screenshot.base64) < MIN_SCREENSHOT_BYTES) {
    screenshot = await helper<ScreenshotResult>("screenshot", {
      displayId,
      targetWidth,
      targetHeight,
      jpegQuality: SCREENSHOT_JPEG_QUALITY
    }, context);
  }
  screenshot.monitorNote = await buildMonitorNote(context, screenshot, previousScreenshot);
  const hiddenNote = previousScreenshot ? await consumeHiddenAppsNote(context) : clearHiddenAppsNote(context);
  screenshot.monitorNote = [screenshot.monitorNote, hiddenNote]
    .filter((line): line is string => Boolean(line))
    .join(" ");
  setLastScreenshot(context, screenshot);
  return screenshot;
}

async function takeZoom(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<ZoomResult> {
  requireComputerUseAllowlist(context);
  const lastScreenshot = getLastScreenshot(context);
  if (!lastScreenshot) {
    throw new ToolError("ComputerUse zoom requires a previous screenshot", "bad-input");
  }
  if ((input.x ?? 0) + (input.width ?? 0) > lastScreenshot.width || (input.y ?? 0) + (input.height ?? 0) > lastScreenshot.height) {
    throw new ToolError(`ComputerUse zoom region exceeds screenshot bounds (${lastScreenshot.width}x${lastScreenshot.height})`, "bad-input");
  }
  const origin = scalePoint(input.x ?? 0, input.y ?? 0, context);
  const region = scaleRegion(input.x ?? 0, input.y ?? 0, input.width ?? 0, input.height ?? 0, context);
  const [targetWidth, targetHeight] = targetImageSize(region.width, region.height, API_RESIZE_PARAMS);
  return helper<ZoomResult>("zoom", {
    x: origin.x,
    y: origin.y,
    width: region.width,
    height: region.height,
    targetWidth,
    targetHeight
  }, context);
}

async function executeComputerUseUnlocked(
  input: ComputerUseInput,
  context: ComputerUseContext,
  options: ComputerUseExecutionOptions = {}
): Promise<string> {
  if (!options.skipHostWindowHide && shouldHideHostWindowForAction(input.action)) {
    await context.hideHostWindow?.();
  }
  if (!options.skipDesktopPrepare && shouldPrepareDesktopForAction(input.action)) {
    await prepareDesktopForAction(context);
  }

  switch (input.action) {
    case "screenshot":
      return formatScreenshot(await takeScreenshot(input, context, options), input, context.cwd);
    case "zoom":
      return formatZoom(await takeZoom(input, context), input, context.cwd);
    case "display_info":
      return formatJson(await helper<DisplayGeometry[]>("list_displays", {}, context));
    case "switch_display":
      return switchComputerUseDisplay(input, context);
    case "permissions":
      return formatPermissions(await helper<Record<string, unknown>>("check_permissions", {}, context));
    case "cursor_position":
      return formatJson(await getCursorPosition(context));
    case "frontmost_app":
      return formatJson(await helper("frontmost_app", {}, context));
    case "app_under_point":
      return formatJson(await helper("app_under_point", scalePoint(input.x ?? 0, input.y ?? 0, context), context));
    case "request_access":
      return requestComputerUseAccess(input, context);
    case "request_teach_access":
      return requestComputerUseTeachAccess(input, context);
    case "list_granted_apps":
      return formatJson({
        allowedApps: [...grantStore(context).values()].sort((a, b) => formatComputerUseApp(a).localeCompare(formatComputerUseApp(b))),
        grantFlags: grantFlags(context)
      });
    case "list_running_apps":
      return formatJson(await helper("list_running_apps", {}, context));
    case "list_installed_apps":
      return formatJson(await helper("list_installed_apps", {}, context));
    case "open_app":
      const openPolicy = await enforceInputPolicy(input, context, "open_app");
      await helper("open_app", { bundleId: openPolicy.app?.bundleId }, context);
      return withOptionalPostActionScreenshot(withPolicyNote(`Opened app ${formatComputerUseApp(openPolicy.app)}.`, openPolicy), input, context);
    case "click":
    case "double_click":
    case "triple_click":
    case "right_click":
    case "middle_click":
      await releaseHeldMouse(context);
      const clickPoint = scalePoint(input.x ?? 0, input.y ?? 0, context);
      const clickModifiers = parseClickModifiers(input, context);
      const clickPolicy = await enforceInputPolicy(input, context, input.action === "right_click" || input.action === "middle_click" || clickModifiers.length > 0 ? "mouse_full" : "mouse", clickPoint);
      const freshnessWarning = options.skipClickFreshness ? undefined : await validateClickFreshness(input, context);
      if (freshnessWarning) return freshnessWarning;
      await helper("click", {
        x: clickPoint.x,
        y: clickPoint.y,
        button: input.action === "right_click" ? "right" : input.action === "middle_click" ? "middle" : "left",
        count: input.action === "double_click" ? 2 : input.action === "triple_click" ? 3 : 1,
        modifiers: clickModifiers
      }, context);
      await wait(MOVE_SETTLE_MS);
      return withOptionalPostActionScreenshot(
        withPolicyNote(`${input.action === "double_click" ? "Double-clicked" : input.action === "triple_click" ? "Triple-clicked" : input.action === "right_click" ? "Right-clicked" : input.action === "middle_click" ? "Middle-clicked" : "Clicked"} at (${input.x}, ${input.y}).`, clickPolicy),
        input,
        context
      );
    case "move":
      const movePoint = scalePoint(input.x ?? 0, input.y ?? 0, context);
      const moveState = getMouseHoldState(context);
      const movePolicy = await enforceInputPolicy(input, context, moveState.held ? "mouse" : "mouse_position", movePoint, {
        targetActionKind: moveState.held ? "mouse_full" : "mouse_position"
      });
      await helper("move_mouse", movePoint, context);
      await wait(MOVE_SETTLE_MS);
      if (moveState.held) moveState.moved = true;
      return withOptionalPostActionScreenshot(withPolicyNote(`Moved pointer to (${input.x}, ${input.y}).`, movePolicy), input, context);
    case "drag":
      await releaseHeldMouse(context);
      const fromPoint = input.x === undefined && input.y === undefined
        ? await helper<Point>("cursor_position", {}, context)
        : scalePoint(input.x ?? 0, input.y ?? 0, context);
      const toPoint = scalePoint(input.toX ?? 0, input.toY ?? 0, context);
      const fromPolicy = await enforceInputPolicy(input, context, "mouse", fromPoint);
      const toPolicy = await enforceInputPolicy(input, context, "mouse", toPoint, { targetActionKind: "mouse_full" });
      await helper("drag", input.x === undefined && input.y === undefined
        ? { to: toPoint }
        : { from: fromPoint, to: toPoint }, context);
      await wait(MOVE_SETTLE_MS);
      return withOptionalPostActionScreenshot(withPolicyNote(`Dragged from ${input.x === undefined && input.y === undefined ? "current cursor" : `(${input.x}, ${input.y})`} to (${input.toX}, ${input.toY}).`, mergePolicyNotes(fromPolicy, toPolicy)), input, context);
    case "left_mouse_down":
      return leftMouseDown(input, context);
    case "left_mouse_up":
      return leftMouseUp(input, context);
    case "scroll":
      const scrollPoint = scalePoint(input.x ?? 0, input.y ?? 0, context);
      const scrollState = getMouseHoldState(context);
      const scrollPolicy = await enforceInputPolicy(input, context, "mouse", scrollPoint, {
        targetActionKind: scrollState.held ? "mouse_full" : "mouse"
      });
      await helper("scroll", {
        x: scrollPoint.x,
        y: scrollPoint.y,
        deltaX: input.deltaX ?? 0,
        deltaY: input.deltaY ?? 0
      }, context);
      if (scrollState.held) scrollState.moved = true;
      return withOptionalPostActionScreenshot(withPolicyNote(`Scrolled at (${input.x}, ${input.y}) by (${input.deltaX ?? 0}, ${input.deltaY ?? 0}).`, scrollPolicy), input, context);
    case "type":
      const typePolicy = await enforceInputPolicy(input, context, "keyboard");
      const shouldUseClipboard = input.viaClipboard === true
        || (input.viaClipboard !== false && shouldUseClipboardForTyping(input.text ?? "", context));
      if (shouldUseClipboard) {
        requireGrantFlag(context, "clipboardWrite", "Clipboard write is not granted. Request `clipboardWrite` via request_access.");
        await helper("paste_text", { text: input.text ?? "" }, context);
      } else {
        await typeTextByGrapheme(input.text ?? "", context);
      }
      return withOptionalPostActionScreenshot(withPolicyNote(`Typed ${JSON.stringify(truncate(input.text ?? "", 120))}.`, typePolicy), input, context);
    case "key":
      blockSystemKeyComboUnlessGranted(input.key ?? "", context);
      const keyPolicy = await enforceInputPolicy(input, context, "keyboard");
      await helper("key", { keySequence: input.key, repeat: input.repeat ?? 1 }, context);
      return withOptionalPostActionScreenshot(withPolicyNote(`Pressed key ${input.key}${input.repeat && input.repeat > 1 ? ` ${input.repeat} times` : ""}.`, keyPolicy), input, context);
    case "hold_key":
      blockSystemKeyComboUnlessGranted(input.key ?? "", context);
      const holdPolicy = await enforceInputPolicy(input, context, "keyboard");
      await helper("hold_key", {
        keyNames: parseKeySequence(input.key ?? ""),
        durationMs: Math.round(input.durationMs ?? 1000)
      }, context);
      return withOptionalPostActionScreenshot(withPolicyNote(`Held key ${input.key} for ${input.durationMs ?? 1000} ms.`, holdPolicy), input, context);
    case "hotkey":
      blockSystemKeyComboUnlessGranted((input.keys ?? []).join("+"), context);
      const hotkeyPolicy = await enforceInputPolicy(input, context, "keyboard");
      await helper("key", { keySequence: (input.keys ?? []).join("+"), repeat: 1 }, context);
      return withOptionalPostActionScreenshot(withPolicyNote(`Pressed hotkey ${(input.keys ?? []).join("+")}.`, hotkeyPolicy), input, context);
    case "read_clipboard":
      requireGrantFlag(context, "clipboardRead", "Clipboard read is not granted. Request `clipboardRead` via request_access.");
      return formatJson({ text: await readClipboardWithClickTierGuard(context) });
    case "write_clipboard":
      requireGrantFlag(context, "clipboardWrite", "Clipboard write is not granted. Request `clipboardWrite` via request_access.");
      await assertClipboardWriteAllowed(context);
      const clipboardPolicy = await enforceInputPolicy(input, context, "keyboard");
      await helper("write_clipboard", { text: input.text ?? "" }, context);
      return withPolicyNote("Clipboard written.", clipboardPolicy);
    case "wait":
      await wait(input.durationMs ?? 1000);
      return `Waited ${input.durationMs ?? 1000} ms.`;
    case "batch":
      return executeComputerUseBatch(input, context);
    case "teach_step":
      return executeComputerUseTeachStep(input, context);
    case "teach_batch":
      return executeComputerUseTeachBatch(input, context);
  }
}

function shouldHideHostWindowForAction(action: ComputerUseAction): boolean {
  return action === "screenshot"
    || action === "frontmost_app"
    || action === "app_under_point"
    || action === "open_app"
    || action === "click"
    || action === "double_click"
    || action === "triple_click"
    || action === "right_click"
    || action === "middle_click"
    || action === "move"
    || action === "drag"
    || action === "left_mouse_down"
    || action === "left_mouse_up"
    || action === "scroll"
    || action === "type"
    || action === "key"
    || action === "hold_key"
    || action === "hotkey"
    || action === "batch"
    || action === "teach_step"
    || action === "teach_batch";
}

function shouldPrepareDesktopForAction(action: ComputerUseAction): boolean {
  return action === "frontmost_app"
    || action === "app_under_point"
    || action === "click"
    || action === "double_click"
    || action === "triple_click"
    || action === "right_click"
    || action === "middle_click"
    || action === "move"
    || action === "drag"
    || action === "left_mouse_down"
    || action === "left_mouse_up"
    || action === "scroll"
    || action === "type"
    || action === "key"
    || action === "hold_key"
    || action === "hotkey";
}

async function gateComputerUseLock(input: ComputerUseInput, context: ComputerUseContext): Promise<void> {
  const deferAcquire = defersComputerUseLockAcquire(input.action);
  const lock = await checkComputerUseLock(context);
  if (lock.kind === "blocked") {
    throw new ToolError(
      `Another Kira session is currently using the computer (${lock.by}). Wait for it to finish or stop that run before starting another desktop action.`,
      "approval-required"
    );
  }
  if (lock.kind === "free" && !deferAcquire) {
    const acquired = await acquireComputerUseLock(context);
    if (acquired.kind === "blocked") {
      throw new ToolError(
        `Another Kira session is currently using the computer (${acquired.by}). Wait for it to finish or stop that run before starting another desktop action.`,
        "approval-required"
      );
    }
    mouseHoldStateBySession.delete(computerUseSessionKey(context));
  }
}

function defersComputerUseLockAcquire(action: ComputerUseAction): boolean {
  return action === "request_access" || action === "list_granted_apps";
}

async function withOptionalPostActionScreenshot(
  message: string,
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  if (input.includePostActionScreenshot !== true) return message;
  const screenshot = await takeScreenshot({ action: "screenshot", displayId: effectiveDisplayId(input, context), includeImage: input.includeImage }, context);
  return [
    message,
    "",
    "[Post-action screenshot]",
    formatScreenshot(screenshot, { action: "screenshot", includeImage: input.includeImage }, context.cwd)
  ].join("\n");
}

async function switchComputerUseDisplay(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  if (isAutoDisplay(input.display)) {
    clearComputerUseDisplaySelection(context);
    setLastScreenshot(context, undefined);
    return "Computer Use display selection reset to auto. Call screenshot next.";
  }
  requireComputerUseAllowlist(context);

  const displays = await helper<DisplayGeometry[]>("list_displays", {}, context);
  const selected = resolveDisplay(input, displays);
  pinComputerUseDisplay(context, displayIdentity(selected));
  setLastScreenshot(context, undefined);
  return [
    `Computer Use display switched to ${displayLabel(selected)}.`,
    `Display ID: ${displayIdentity(selected)}`,
    "Call screenshot next. Coordinates will refer to that new screenshot."
  ].join("\n");
}

async function leftMouseDown(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  const state = getMouseHoldState(context);
  if (state.held) {
    throw new ToolError("mouse button already held, call left_mouse_up first", "bad-input");
  }
  const cursor = await helper<Point>("cursor_position", {}, context);
  const policy = await enforceInputPolicy(input, context, "mouse", cursor);
  await helper("mouse_down", {}, context);
  state.held = true;
  state.moved = false;
  return withPolicyNote("Mouse button pressed.", policy);
}

async function leftMouseUp(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  const state = getMouseHoldState(context);
  let policy: PolicyCheckResult | undefined;
  try {
    const cursor = await helper<Point>("cursor_position", {}, context);
    policy = await enforceInputPolicy(input, context, "mouse", cursor, {
      targetActionKind: state.moved ? "mouse_full" : "mouse"
    });
  } catch (error) {
    if (state.held) {
      await releaseHeldMouse(context, true);
    }
    throw error;
  }
  await helper("mouse_up", {}, context);
  state.held = false;
  state.moved = false;
  return withPolicyNote("Mouse button released.", policy);
}

async function requestComputerUseAccess(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  if (teachModeBySession.get(computerUseSessionKey(context))) {
    throw new ToolError(
      "Cannot request additional Computer Use permissions during teach mode. Finish or exit the current guide, then call request_access again.",
      "approval-required"
    );
  }
  const requested = input.apps ?? [];
  if (requested.length === 0) {
    throw new ToolError("ComputerUse request_access requires apps", "bad-input");
  }
  const running = await helper<AppInfo[]>("list_running_apps", {}, context, { timeoutMs: FAST_APP_LIST_TIMEOUT_MS }).catch(() => [] as AppInfo[]);
  const installed = await helper<AppInfo[]>("list_installed_apps", {}, context, { timeoutMs: FAST_APP_LIST_TIMEOUT_MS }).catch(() => [] as AppInfo[]);
  const candidates = [...running, ...installed];
  const granted: AppGrant[] = [];
  const denied: ComputerUseAccessDenial[] = [];
  const policyDenied: PolicyDeniedRequest[] = [];
  const userDenied: PolicyDeniedRequest[] = [];
  const flags = grantFlags(context);
  const approvedApps = approvalGrantedApps(context.approvalResponse);
  const deniedAppKeys = approvalDeniedAppKeys(context.approvalResponse);
  const appsToEvaluate = approvedApps ?? requested;
  const approvedAppKeys = approvedApps ? buildApprovalAppKeySet(approvedApps, candidates) : undefined;
  const responseFlags = context.approvalResponse?.flags;
  if (responseFlags) {
    if (typeof responseFlags.clipboardRead === "boolean") flags.clipboardRead = responseFlags.clipboardRead;
    if (typeof responseFlags.clipboardWrite === "boolean") flags.clipboardWrite = responseFlags.clipboardWrite;
    if (typeof responseFlags.systemKeyCombos === "boolean") flags.systemKeyCombos = responseFlags.systemKeyCombos;
  } else {
    if (input.clipboardRead === true) flags.clipboardRead = true;
    if (input.clipboardWrite === true) flags.clipboardWrite = true;
    if (input.systemKeyCombos === true) flags.systemKeyCombos = true;
  }

  if (approvedAppKeys) {
    for (const appName of requested) {
      const requestedApp = resolveRequestedApp(appName, candidates);
      if (!approvalKeySetHas(approvedAppKeys, appName, requestedApp) || approvalKeySetHas(deniedAppKeys, appName, requestedApp)) {
        addAccessDenial(denied, requestedApp, appName, "user_denied");
      }
    }
  }

  for (const appName of appsToEvaluate) {
    const app = resolveRequestedApp(appName, candidates);
    if (approvalKeySetHas(deniedAppKeys, appName, app)) {
      addAccessDenial(denied, app, appName, "user_denied");
      continue;
    }
    if (!app) {
      const policyApp = appInfoForPolicyLookup(appName);
      const policy = evaluateComputerUseAppPolicy(policyApp, "mouse_position");
      if (!policy.allowed || policy.category === "policy_denied") {
        const reason = policy.reason ?? "blocked by policy";
        if (policy.category === "policy_denied") {
          policyDenied.push({
            requestedName: appName,
            displayName: policyApp.displayName ?? appName,
            reason
          });
        }
      } else {
        addAccessDenial(denied, undefined, appName, "not_installed");
      }
      continue;
    }
    const policy = evaluateComputerUseAppPolicy(app, "mouse_position");
    if (!policy.allowed || policy.category === "policy_denied") {
      const reason = policy.reason ?? "blocked by policy";
      if (policy.category === "policy_denied") {
        policyDenied.push({
          requestedName: appName,
          displayName: app?.displayName ?? appName,
          reason
        });
      }
      continue;
    }
    if (isUserDeniedApp(app, context)) {
      userDenied.push({
        requestedName: appName,
        displayName: app.displayName ?? appName,
        reason: "user denied"
      });
      continue;
    }
    const grant: AppGrant = {
      bundleId: app.bundleId,
      displayName: app.displayName,
      tier: getDefaultComputerUseTier(app),
      grantedAt: new Date().toISOString()
    };
    grantStore(context).set(grantKey(grant), grant);
    granted.push(grant);
  }
  const windowLocations = await buildWindowLocations(context, granted);
  const willHide = await previewComputerUseHideSet(context);
  const policyDeniedGuidance = buildComputerUsePolicyDeniedGuidance(policyDenied);
  const userDeniedGuidance = buildComputerUseUserDeniedGuidance(userDenied);
  const tierGuidance = buildComputerUseTierGuidance(granted);

  return formatJson({
    reason: input.reason ?? "No reason provided.",
    granted,
    denied,
    grantFlags: flags,
    ...(policyDenied.length > 0 ? {
      policyDenied: {
        apps: policyDenied,
        guidance: policyDeniedGuidance
      }
    } : {}),
    ...(userDenied.length > 0 ? {
      userDenied: {
        apps: userDenied,
        guidance: userDeniedGuidance
      }
    } : {}),
    ...(tierGuidance ? { tierGuidance } : {}),
    screenshotFiltering: screenshotFilteringMode(),
    ...(windowLocations.length > 0 ? { windowLocations } : {}),
	    ...(willHide.length > 0 ? {
	      willHide,
	      autoUnhideEnabled: true
	    } : {})
	  });
	}

function addAccessDenial(
  denied: ComputerUseAccessDenial[],
  app: AppInfo | undefined,
  requestedName: string,
  reason: ComputerUseAccessDenial["reason"]
): void {
  const bundleId = app?.bundleId || app?.displayName || requestedName;
  const key = `${bundleId}\0${reason}`;
  if (denied.some((item) => `${item.bundleId}\0${item.reason}` === key)) return;
  denied.push({ bundleId, reason });
}

async function requestComputerUseTeachAccess(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  if (!context.teachStepResolver) {
    throw new ToolError("ComputerUse teach mode is not available in this session.", "approval-required");
  }
  if (teachModeBySession.get(computerUseSessionKey(context))) {
    throw new ToolError(
      "Teach mode is already active. Finish or exit the current guide before starting another one.",
      "approval-required"
    );
  }
  const accessResult = await requestComputerUseAccess(input, context);
  const accessPayload = parseAccessResultPayload(accessResult);
  const grantedCount = accessPayload?.granted?.length ?? grantStore(context).size;
  const teachModeActive = context.approvalResponse?.userConsented === true && grantedCount > 0;
  if (!teachModeActive) {
    teachModeBySession.delete(computerUseSessionKey(context));
    return formatJson({
      ...(accessPayload ?? { message: accessResult }),
      teachModeActive: false
    });
  }
  teachModeBySession.set(computerUseSessionKey(context), true);
  await context.teachModeActivated?.();
	  return formatJson({
	    ...(accessPayload ?? { message: accessResult }),
	    teachModeActive
	  });
	}

async function executeComputerUseBatch(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  const actions = input.actions ?? [];
  const preBatchScreenshot = getLastScreenshot(context);
  const completed: ComputerUseBatchActionResult[] = [];
  const batchOptions: ComputerUseExecutionOptions = {
    skipHostWindowHide: true,
    skipDesktopPrepare: true,
    skipClickFreshness: true
  };

  await prepareDesktopForAction(context);

  for (const [index, item] of actions.entries()) {
    if (context.signal?.aborted) {
      await releaseHeldMouse(context, true);
      throw new ToolError("ComputerUse batch was interrupted", "command-failed");
    }
    if (index > 0) await wait(10);
    setLastScreenshot(context, preBatchScreenshot);
    const itemInput: ComputerUseInput = {
      ...item,
      includeImage: false,
      includePostActionScreenshot: false,
      displayId: effectiveDisplayId(input, context)
    };
    try {
      validateComputerUseInput(itemInput);
      const output = await executeComputerUseUnlocked(itemInput, context, batchOptions);
      completed.push({ action: item.action, ok: true, output: firstResultLine(output) });
    } catch (error) {
      await releaseHeldMouse(context, true);
      const toolError = asComputerUseError(error, item.action);
      return formatJson({
        completed,
        failed: {
          action: item.action,
          ok: false,
          output: toolError.message
        },
        remaining: actions.length - completed.length - 1
      });
    }
  }

  setLastScreenshot(context, preBatchScreenshot);
  return formatJson({ completed });
}

async function executeComputerUseTeachStep(
  input: ComputerUseInput,
  context: ComputerUseContext,
  stepIndex?: number,
  stepCount?: number,
  options: { includeFinalScreenshot?: boolean } = {}
): Promise<string> {
  if (!context.teachStepResolver || !teachModeBySession.get(computerUseSessionKey(context))) {
    throw new ToolError("Teach mode is not active. Call ComputerUse request_teach_access first.", "approval-required");
  }
  const step = inputToTeachStep(input, "teach_step");
  const result = await context.teachStepResolver({
    explanation: step.explanation,
    nextPreview: step.nextPreview,
    anchor: step.anchor ? scalePoint(step.anchor[0], step.anchor[1], context) : undefined,
    actionCount: step.actions.length,
    stepIndex,
    stepCount
  });
  if (result.action === "exit") {
    await releaseHeldMouse(context, true);
    teachModeBySession.delete(computerUseSessionKey(context));
    await context.teachModeExited?.();
    return formatJson({ exited: true });
  }
  if (step.actions.length === 0) {
    return formatJson({ executed: 0, results: [] });
  }
  const batchResult = await executeComputerUseBatch({
    action: "batch",
    actions: step.actions,
    includeImage: input.includeImage,
    includePostActionScreenshot: false
  }, context);
  const batchPayload = parseBatchResultPayload(batchResult);
  if (batchPayload && "failed" in batchPayload) {
    return formatJson({
      executed: batchPayload.completed.length,
      failed: batchPayload.failed,
      remaining: batchPayload.remaining
    });
  }
  const completed = batchPayload?.completed ?? [];
  const message = formatJson({
    executed: completed.length,
    results: completed
  });
  return options.includeFinalScreenshot === false ? message : withPostActionScreenshot(message, input, context);
}

async function executeComputerUseTeachBatch(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  if (!context.teachStepResolver || !teachModeBySession.get(computerUseSessionKey(context))) {
    throw new ToolError("Teach mode is not active. Call ComputerUse request_teach_access first.", "approval-required");
  }
  const steps = input.steps ?? [];
  const preBatchScreenshot = getLastScreenshot(context);
  const results: ComputerUseBatchActionResult[][] = [];

  for (const [index, step] of steps.entries()) {
    if (context.signal?.aborted) {
      await releaseHeldMouse(context, true);
      throw new ToolError("ComputerUse teach_batch was interrupted", "command-failed");
    }
    setLastScreenshot(context, preBatchScreenshot);
    const result = await executeComputerUseTeachStep({
      action: "teach_step",
      explanation: step.explanation,
      nextPreview: step.nextPreview,
      anchor: step.anchor,
      actions: step.actions,
      includeImage: false,
      includePostActionScreenshot: false
    }, context, index + 1, steps.length, { includeFinalScreenshot: false });
    if (result.includes('"exited": true')) {
      return formatJson({ exited: true, stepsCompleted: index });
    }
    const stepPayload = parseTeachStepResultPayload(result);
    if (stepPayload && "failed" in stepPayload) {
      return formatJson({
        stepsCompleted: index,
        stepFailed: index,
        executed: stepPayload.executed,
        failed: stepPayload.failed,
        remaining: stepPayload.remaining,
        results
      });
    }
    results.push(stepPayload?.results ?? []);
  }

  setLastScreenshot(context, preBatchScreenshot);
  const message = formatJson({ stepsCompleted: results.length, results });
  const screenChanged = steps.some((step) => step.actions.length > 0);
  return screenChanged ? withPostActionScreenshot(message, input, context) : message;
}

function withPostActionScreenshot(
  message: string,
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string> {
  return withOptionalPostActionScreenshot(message, { ...input, includePostActionScreenshot: true }, context);
}

async function enforceInputPolicy(
  input: ComputerUseInput,
  context: ComputerUseContext,
  actionKind: ComputerUseActionKind,
  point?: Point,
  options: { targetActionKind?: ComputerUseActionKind } = {}
): Promise<PolicyCheckResult> {
  if (actionKind === "open_app") {
    return enforceTargetPolicy(await resolveTargetApp(input, context), actionKind, context);
  }

  const targetActionKind = options.targetActionKind ?? actionKind;
  const hasExplicitTarget = Boolean(input.app || input.bundleId || point);
  const target = await resolveTargetApp(input, context, point);
  const targetPolicy = enforceTargetPolicy(target, targetActionKind, context);
  const frontmost = await helper<AppInfo | null>("frontmost_app", {}, context).catch(() => null);
  await syncClipboardStash(context, frontmost ? findGrantForApp(frontmost, context)?.tier === "click" : false);
  const frontmostPolicy = enforceObservedAppPolicy(frontmost ?? undefined, actionKind, context, "frontmost");
  const policies = hasExplicitTarget
    ? [targetPolicy, frontmostPolicy]
    : [frontmostPolicy, targetPolicy];

  if (point) {
    const pointApp = await helper<AppInfo | null>("app_under_point", point, context).catch(() => null);
    if (pointApp) {
      policies.push(enforceObservedAppPolicy(pointApp, targetActionKind, context, "point"));
    }
  }

  return mergePolicyChecks(...policies);
}

function enforceTargetPolicy(
  app: AppInfo | undefined,
  actionKind: ComputerUseActionKind,
  context: ComputerUseContext
): PolicyGateResult {
  const decision = evaluateComputerUseAppPolicy(app, actionKind);
  if (!decision.allowed) {
    throw new ToolError(`${decision.reason ?? `Computer Use blocked this action for ${formatComputerUseApp(app)}.`}${TIER_ANTI_SUBVERSION}`, "approval-required");
  }
  const grant = enforceGrantTier(app, actionKind, context, "target");
  return {
    app,
    note: decision.warning,
    tier: grant?.tier,
    role: "target"
  };
}

function enforceObservedAppPolicy(
  app: AppInfo | undefined,
  actionKind: ComputerUseActionKind,
  context: ComputerUseContext,
  role: "frontmost" | "point"
): PolicyGateResult {
  if (!app || isAlwaysAllowedObservedApp(app)) {
    return { app, role };
  }
  const decision = evaluateComputerUseAppPolicy(app, actionKind);
  if (!decision.allowed) {
    throw new ToolError(`${observedAppPrefix(role, app)} ${decision.reason ?? "Computer Use policy blocks this app."}${TIER_ANTI_SUBVERSION}`, "approval-required");
  }
  const grant = enforceGrantTier(app, actionKind, context, role);
  return {
    app,
    note: decision.warning,
    tier: grant?.tier,
    role
  };
}

function enforceGrantTier(
  app: AppInfo | undefined,
  actionKind: ComputerUseActionKind,
  context: ComputerUseContext,
  role: "target" | "frontmost" | "point"
): AppGrant | undefined {
  if (!app) {
    throw new ToolError("ComputerUse could not identify the target app. Take a screenshot and request access to the visible app before controlling it.", "approval-required");
  }
  const grant = findGrantForApp(app, context);
  if (!grant) {
    throw new ToolError(`${observedAppPrefix(role, app)} is not granted for this Computer Use session. Call ComputerUse request_access first.${role === "target" ? "" : " Take a fresh screenshot if the window layout changed."}`, "approval-required");
  }
  if (actionKind === "open_app") return grant;
  if (grant.tier === "read" && actionKind !== "mouse_position") {
    const category = getComputerUseAppCategory(app);
    const guidance = category === "browser"
      ? " Kira can observe the visible browser page, but cannot click, type, scroll, navigate, or send shortcuts there through Computer Use. Use the user's visible browser only for observation; if interaction is required, ask the user to perform it or use an explicit non-ComputerUse browser/data source when appropriate."
      : " Kira can observe this app only. Ask the user to perform any actions in this app themselves.";
    throw new ToolError(`${observedAppPrefix(role, app)} is granted at read tier only.${guidance}${TIER_ANTI_SUBVERSION}`, "approval-required");
  }
  if (grant.tier === "click" && (actionKind === "keyboard" || actionKind === "mouse_full")) {
    throw new ToolError(`${observedAppPrefix(role, app)} is granted at click tier. Kira may move, scroll, or plain-click, but cannot type, drag, right-click, or send shortcuts there.${TIER_ANTI_SUBVERSION}`, "approval-required");
  }
  return grant;
}

async function readClipboardWithClickTierGuard(context: ComputerUseContext): Promise<string> {
  const frontmost = await helper<AppInfo | null>("frontmost_app", {}, context).catch(() => null);
  await syncClipboardStash(context, frontmost ? findGrantForApp(frontmost, context)?.tier === "click" : false);
  return helper<string>("read_clipboard", {}, context);
}

async function assertClipboardWriteAllowed(context: ComputerUseContext): Promise<void> {
  const frontmost = await helper<AppInfo | null>("frontmost_app", {}, context).catch(() => null);
  const frontmostIsClickTier = frontmost ? findGrantForApp(frontmost, context)?.tier === "click" : false;
  if (!frontmost || !frontmostIsClickTier) {
    await syncClipboardStash(context, false);
    return;
  }
  throw new ToolError(
    `${formatComputerUseApp(frontmost)} is a tier-"click" app and currently frontmost. write_clipboard is blocked because the next action would clear the clipboard anyway; a UI Paste button in this app cannot be used to inject text. Bring a tier-"full" app forward before writing to the clipboard.${TIER_ANTI_SUBVERSION}`,
    "approval-required"
  );
}

async function syncClipboardStash(context: ComputerUseContext, frontmostIsClickTier: boolean): Promise<void> {
  const key = computerUseSessionKey(context);
  const current = clipboardStashBySession.get(key);
  if (!frontmostIsClickTier) {
    if (current === undefined) return;
    try {
      await helper("write_clipboard", { text: current }, context);
      clipboardStashBySession.delete(key);
    } catch {
      // Best effort: keep the stash so the next non-click-tier action can retry.
    }
    return;
  }
  if (current === undefined) {
    try {
      clipboardStashBySession.set(key, await helper<string>("read_clipboard", {}, context));
    } catch {
      clipboardStashBySession.set(key, "");
    }
  }
  try {
    await helper("write_clipboard", { text: "" }, context);
  } catch {
    // The tier gate still blocks keyboard/right-click paste. Treat pasteboard failures as best effort.
  }
}

async function restoreClipboardStash(context: Pick<ComputerUseContext, "cwd" | "kiraWorkspaceRoot" | "sessionId" | "env" | "signal">): Promise<void> {
  const key = computerUseSessionKey(context);
  const current = clipboardStashBySession.get(key);
  if (current === undefined) return;
  try {
    await helper("write_clipboard", { text: current }, context);
    clipboardStashBySession.delete(key);
  } catch {
    // Best effort cleanup: clipboard restore must never mask the agent result.
  }
}

function shouldUseClipboardForTyping(text: string, context: ComputerUseContext): boolean {
  if (!grantFlags(context).clipboardWrite) return false;
  if (text.includes("\n")) return true;
  if (os.platform() === "darwin") {
    return /[^\r\n\t]/u.test(text);
  }
  if (os.platform() === "win32") {
    return /[^\u0000-\u007f]/u.test(text);
  }
  return false;
}

function blockSystemKeyCombo(sequence: string): void {
  if (!sequence) return;
  if (isSystemComputerUseKeyCombo(sequence)) {
    throw new ToolError(
      `ComputerUse blocked system-level shortcut "${sequence}". It can switch apps, close windows, quit apps, lock the screen, or trigger OS UI.`,
      "approval-required"
    );
  }
}

function blockSystemKeyComboUnlessGranted(sequence: string, context: ComputerUseContext): void {
  if (!sequence) return;
  if (isSystemComputerUseKeyCombo(sequence) && !grantFlags(context).systemKeyCombos) {
    throw new ToolError(
      `ComputerUse blocked system-level shortcut "${sequence}". Request the \`systemKeyCombos\` grant via request_access to use it.`,
      "approval-required"
    );
  }
}

function parseClickModifiers(input: ComputerUseInput, context: ComputerUseContext): string[] {
  if (input.text === undefined) return [];
  blockSystemKeyComboUnlessGranted(input.text, context);
  return input.text.split("+").map((part) => part.trim()).filter(Boolean);
}

function requireGrantFlag(context: ComputerUseContext, flag: keyof ComputerUseGrantFlags, message: string): void {
  if (!grantFlags(context)[flag]) {
    throw new ToolError(message, "approval-required");
  }
}

function grantFlags(context: ComputerUseContext): ComputerUseGrantFlags {
  const key = computerUseSessionKey(context);
  let flags = grantFlagsBySession.get(key);
  if (!flags) {
    flags = { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false };
    grantFlagsBySession.set(key, flags);
  }
  return flags;
}

function requireComputerUseAllowlist(context: ComputerUseContext): void {
  if (grantStore(context).size === 0) {
    throw new ToolError("No applications are granted for this Computer Use session. Call ComputerUse request_access first.", "approval-required");
  }
}

function parseKeySequence(sequence: string): string[] {
  return sequence
    .split("+")
    .map((key) => key.trim())
    .filter(Boolean);
}

function withPolicyNote(message: string, policy: PolicyCheckResult): string {
  const app = policy.app ? `Target app: ${formatComputerUseApp(policy.app)}` : undefined;
  return [message, app, policy.note].filter((line): line is string => Boolean(line)).join("\n");
}

function mergePolicyChecks(...policies: PolicyGateResult[]): PolicyCheckResult {
  const targetPolicy = policies.find((policy) => policy.role === "target");
  const clickTierPolicy = policies.find((policy) => policy.tier === "click");
  const notes = policies.map((policy) => policy.note).filter(Boolean);
  return {
    app: targetPolicy?.app,
    note: [...new Set(notes)].join("\n") || undefined,
    tier: clickTierPolicy?.tier ?? targetPolicy?.tier
  };
}

function mergePolicyNotes(...policies: PolicyCheckResult[]): PolicyCheckResult {
  const apps = policies.map((policy) => policy.app ? formatComputerUseApp(policy.app) : undefined).filter(Boolean);
  const notes = policies.map((policy) => policy.note).filter(Boolean);
  return {
    note: [
      apps.length > 0 ? `Target apps: ${[...new Set(apps)].join(" -> ")}` : undefined,
      ...[...new Set(notes)]
    ].filter((line): line is string => Boolean(line)).join("\n")
  };
}

function isAlwaysAllowedObservedApp(app: AppInfo): boolean {
  const id = (app.bundleId || app.displayName || "").trim().toLowerCase();
  return id === FINDER_BUNDLE_ID || id === WINDOWS_EXPLORER_BUNDLE_ID || id === "finder" || id === "explorer";
}

function observedAppPrefix(role: "target" | "frontmost" | "point", app: AppInfo): string {
  const name = formatComputerUseApp(app);
  if (role === "frontmost") return `${name} is currently in front and`;
  if (role === "point") return `Click at these coordinates would land on ${name}, which`;
  return name;
}

async function validateClickFreshness(
  input: ComputerUseInput,
  context: ComputerUseContext
): Promise<string | undefined> {
  const lastScreenshot = getLastScreenshot(context);
  if (!lastScreenshot?.base64 || !lastScreenshot.width || !lastScreenshot.height) {
    return undefined;
  }
  const validation = await helper<PixelValidationResult>("validate_click_target", {
    lastScreenshotBase64: lastScreenshot.base64,
    lastScreenshotPath: lastScreenshot.filePath,
    displayId: lastScreenshot.displayId,
    targetWidth: lastScreenshot.width,
    targetHeight: lastScreenshot.height,
    xPercent: ((input.x ?? 0) / lastScreenshot.width) * 100,
    yPercent: ((input.y ?? 0) / lastScreenshot.height) * 100,
    gridSize: 9
  }, context).catch(() => ({ valid: true, skipped: true }) satisfies PixelValidationResult);
  if (!validation.valid && validation.warning) {
    return validation.warning;
  }
  return undefined;
}

async function getCursorPosition(context: ComputerUseContext): Promise<Record<string, unknown>> {
  const logical = await helper<Point>("cursor_position", {}, context);
  const lastScreenshot = getLastScreenshot(context);
  if (!lastScreenshot) {
    return {
      ...logical,
      coordinateSpace: "logical_points",
      note: "take a screenshot first for image-pixel coordinates"
    };
  }
  const originX = lastScreenshot.originX ?? 0;
  const originY = lastScreenshot.originY ?? 0;
  const localX = logical.x - originX;
  const localY = logical.y - originY;
  if (localX < 0 || localY < 0 || localX > lastScreenshot.displayWidth || localY > lastScreenshot.displayHeight) {
    return {
      x: logical.x,
      y: logical.y,
      coordinateSpace: "logical_points",
      note: "cursor is on a different monitor than your last screenshot; take a fresh screenshot"
    };
  }
  return {
    x: Math.round(localX * (lastScreenshot.width / lastScreenshot.displayWidth)),
    y: Math.round(localY * (lastScreenshot.height / lastScreenshot.displayHeight)),
    coordinateSpace: "image_pixels"
  };
}

async function resolveTargetApp(
  input: ComputerUseInput,
  context: ComputerUseContext,
  point?: Point
): Promise<AppInfo | undefined> {
  if (input.bundleId) {
    return { bundleId: input.bundleId, displayName: input.bundleId };
  }
  if (input.app) {
    return resolveGrantedApp(input.app, context);
  }
  if (point) {
    const app = await helper<AppInfo | null>("app_under_point", point, context);
    return app ?? undefined;
  }
  const app = await helper<AppInfo | null>("frontmost_app", {}, context);
  return app ?? undefined;
}

function resolveRequestedApp(requested: string, candidates: AppInfo[]): AppInfo | undefined {
  const requestedKeys = approvalKeysForValue(requested);
  return candidates.find((app) =>
    Boolean(app.bundleId && requestedKeys.has(normalizeApprovalName(app.bundleId)))
    || Boolean(app.displayName && requestedKeys.has(normalizeApprovalName(app.displayName)))
  ) ?? builtInAppForApproval(requestedKeys);
}

function builtInAppForApproval(requestedKeys: Set<string>): AppInfo | undefined {
  if (requestedKeys.has(FINDER_BUNDLE_ID) || requestedKeys.has("finder") || requestedKeys.has("访达")) {
    return { bundleId: FINDER_BUNDLE_ID, displayName: "Finder" };
  }
  if (requestedKeys.has(SAFARI_BUNDLE_ID) || requestedKeys.has("safari") || requestedKeys.has("safari浏览器")) {
    return { bundleId: SAFARI_BUNDLE_ID, displayName: "Safari" };
  }
  if (requestedKeys.has(WINDOWS_EXPLORER_BUNDLE_ID) || requestedKeys.has("explorer") || requestedKeys.has("file explorer") || requestedKeys.has("windows explorer")) {
    return { bundleId: WINDOWS_EXPLORER_BUNDLE_ID, displayName: "File Explorer" };
  }
  return undefined;
}

function appInfoForPolicyLookup(requested: string): AppInfo {
  return looksLikeBundleId(requested)
    ? { bundleId: requested, displayName: requested }
    : { displayName: requested };
}

function looksLikeBundleId(value: string): boolean {
  return /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value.trim());
}

function approvalGrantedApps(response: ComputerUseApprovalResponse | undefined): string[] | undefined {
  if (!response) return undefined;
  if (response.grantedApps) return response.grantedApps;
  if (response.granted) {
    return response.granted.map((grant) => grant.bundleId || grant.displayName).filter((app): app is string => Boolean(app));
  }
  return undefined;
}

function approvalDeniedApps(response: ComputerUseApprovalResponse | undefined): string[] {
  if (!response) return [];
  const deniedApps = response.deniedApps ?? [];
  const deniedGrants = response.denied?.map((denial) => denial.bundleId).filter(Boolean) ?? [];
  return [...deniedApps, ...deniedGrants];
}

function approvalDeniedAppKeys(response: ComputerUseApprovalResponse | undefined): Set<string> {
  const keys = new Set<string>();
  for (const value of approvalDeniedApps(response)) {
    addApprovalKey(keys, value);
  }
  return keys;
}

function buildApprovalAppKeySet(values: string[], candidates: AppInfo[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    addApprovalKey(keys, value);
    const app = resolveRequestedApp(value, candidates);
    addApprovalKey(keys, app?.bundleId);
    addApprovalKey(keys, app?.displayName);
  }
  return keys;
}

function approvalKeySetHas(keys: Set<string> | undefined, requested: string, app: AppInfo | undefined): boolean {
  if (!keys || keys.size === 0) return false;
  return keys.has(normalizeApprovalName(requested))
    || Boolean(app?.bundleId && keys.has(normalizeApprovalName(app.bundleId)))
    || Boolean(app?.displayName && keys.has(normalizeApprovalName(app.displayName)));
}

function addApprovalKey(keys: Set<string>, value: string | undefined): void {
  if (!value) return;
  for (const alias of approvalKeysForValue(value)) {
    keys.add(alias);
  }
}

function approvalKeysForValue(value: string): Set<string> {
  const normalized = normalizeApprovalName(value);
  return new Set([normalized, ...approvalAliasesForKey(normalized)]);
}

function approvalAliasesForKey(normalized: string): string[] {
  if (normalized === FINDER_BUNDLE_ID || normalized === "finder" || normalized === "访达") {
    return [FINDER_BUNDLE_ID, "finder", "访达"];
  }
  if (normalized === SAFARI_BUNDLE_ID || normalized === "safari" || normalized === "safari浏览器") {
    return [SAFARI_BUNDLE_ID, "safari", "safari浏览器"];
  }
  if (normalized === WINDOWS_EXPLORER_BUNDLE_ID || normalized === "explorer" || normalized === "file explorer" || normalized === "windows explorer") {
    return [WINDOWS_EXPLORER_BUNDLE_ID, "explorer", "file explorer", "windows explorer"];
  }
  return [];
}

function normalizeApprovalName(value: string): string {
  return value.trim().toLowerCase();
}

async function buildWindowLocations(
  context: ComputerUseContext,
  granted: AppGrant[]
): Promise<Array<AppGrant & { displays: string[] }>> {
  if (granted.length === 0) return [];
  const displays = await helper<DisplayGeometry[]>("list_displays", {}, context).catch(() => [] as DisplayGeometry[]);
  if (displays.length <= 1) return [];
  const locations = await helper<Array<{ bundleId: string; displayIds: number[] }>>(
    "find_window_displays",
    { bundleIds: granted.map((grant) => grant.bundleId).filter(Boolean) },
    context
  ).catch(() => []);
  if (locations.length === 0) return [];
  const displayById = new Map(
    displays.map((display) => [
      display.displayId ?? display.id ?? -1,
      display.label || display.name || `Display ${display.displayId ?? display.id}`
    ])
  );
  return granted.flatMap((grant) => {
    const match = locations.find((item) => item.bundleId === grant.bundleId);
    if (!match || match.displayIds.length === 0) return [];
    const displayLabels = match.displayIds.map((id) => displayById.get(id) || `Display ${id}`);
    return [{ ...grant, displays: displayLabels }];
  });
}

function clearHiddenAppsNote(context: ComputerUseContext): undefined {
  hiddenSinceLastScreenshotBySession.set(computerUseSessionKey(context), []);
  return undefined;
}

async function previewComputerUseHideSet(context: ComputerUseContext): Promise<AppInfo[]> {
  const exemptBundleIds = grantedBundleIds(context);
  if (exemptBundleIds.length === 0) return [];
  return helper<AppInfo[]>("preview_hide_set", {
    exemptBundleIds,
    displayId: effectiveDisplayId({ action: "screenshot" }, context)
  }, context).catch(() => [] as AppInfo[]);
}

async function prepareDesktopForAction(context: ComputerUseContext, displayId = effectiveDisplayId({ action: "screenshot" }, context)): Promise<void> {
  const exemptBundleIds = grantedBundleIds(context);
  if (exemptBundleIds.length === 0) return;
  const hidden = await helper<string[]>("prepare_for_action", {
    exemptBundleIds,
    displayId
  }, context).catch(() => [] as string[]);
  if (hidden.length === 0) return;
  rememberHiddenApps(context, hidden);
}

function grantedBundleIds(context: ComputerUseContext): string[] {
  return [...grantStore(context).values()]
    .map((grant) => grant.bundleId)
    .filter((bundleId): bundleId is string => Boolean(bundleId));
}

function rememberHiddenApps(context: ComputerUseContext, bundleIds: string[]): void {
  const key = computerUseSessionKey(context);
  let hidden = hiddenAppsBySession.get(key);
  if (!hidden) {
    hidden = new Map();
    hiddenAppsBySession.set(key, hidden);
  }
  const runningByBundle = new Map(
    [...grantStore(context).values()].map((grant) => [grant.bundleId, grant] as const)
  );
  const sinceLast = hiddenSinceLastScreenshotBySession.get(key) ?? [];
  for (const bundleId of bundleIds) {
    if (!bundleId) continue;
    const app = runningByBundle.get(bundleId) ?? { bundleId, displayName: bundleId };
    hidden.set(bundleId, app);
    sinceLast.push(bundleId);
  }
  hiddenSinceLastScreenshotBySession.set(key, [...new Set(sinceLast)]);
}

async function consumeHiddenAppsNote(context: ComputerUseContext): Promise<string | undefined> {
  const key = computerUseSessionKey(context);
  const bundleIds = hiddenSinceLastScreenshotBySession.get(key) ?? [];
  if (bundleIds.length === 0) return undefined;
  hiddenSinceLastScreenshotBySession.set(key, []);
  const running = await helper<AppInfo[]>("list_running_apps", {}, context).catch(() => [] as AppInfo[]);
  const namesByBundle = new Map(running.map((app) => [app.bundleId, app.displayName] as const));
  const hidden = hiddenAppsBySession.get(key);
  const names = bundleIds.map((bundleId) =>
    namesByBundle.get(bundleId)
    || hidden?.get(bundleId)?.displayName
    || bundleId
  );
  const unique = [...new Set(names)].filter(Boolean);
  if (unique.length === 0) return undefined;
  const list = unique.map((name) => `"${name}"`).join(", ");
  const one = unique.length === 1;
  return `${list} ${one ? "was" : "were"} open and got hidden before this screenshot because ${one ? "it is" : "they are"} not in the Computer Use allowlist. If you need ${one ? "it" : "one of them"}, call request_access to add ${one ? "it" : "them"}.`;
}

function resolveGrantedApp(requested: string, context: ComputerUseContext): AppGrant | undefined {
  const needle = requested.trim().toLowerCase();
  const requestedKeys = new Set([needle, ...approvalAliasesForKey(needle)]);
  return [...grantStore(context).values()].find((grant) =>
    Boolean(grant.bundleId && requestedKeys.has(grant.bundleId.trim().toLowerCase()))
    || Boolean(grant.displayName && requestedKeys.has(grant.displayName.trim().toLowerCase()))
  );
}

function findGrantForApp(app: AppInfo, context: ComputerUseContext): AppGrant | undefined {
  const grants = grantStore(context);
  const direct = grants.get(grantKey(app));
  if (direct) return direct;
  const bundle = app.bundleId?.trim().toLowerCase();
  const display = app.displayName?.trim().toLowerCase();
  return [...grants.values()].find((grant) =>
    Boolean(bundle && grant.bundleId?.trim().toLowerCase() === bundle)
    || Boolean(display && grant.displayName?.trim().toLowerCase() === display)
  );
}

function grantKey(app: AppInfo): string {
  return (app.bundleId || app.displayName || "").trim().toLowerCase();
}

function grantStore(context: ComputerUseContext): Map<string, AppGrant> {
  const key = computerUseSessionKey(context);
  let grants = grantsBySession.get(key);
  if (!grants) {
    grants = new Map();
    grantsBySession.set(key, grants);
  }
  return normalizeGrantStore(grants, context);
}

function normalizeGrantStore(grants: Map<string, AppGrant>, context: ComputerUseContext): Map<string, AppGrant> {
  for (const [key, grant] of [...grants.entries()]) {
    const decision = evaluateComputerUseAppPolicy(grant, "mouse_position");
    if (!decision.allowed || decision.category === "policy_denied" || isUserDeniedApp(grant, context)) {
      grants.delete(key);
      continue;
    }
    const tier = grant.tier ?? getDefaultComputerUseTier(grant);
    if (grant.tier !== tier) {
      grants.set(key, { ...grant, tier });
    }
  }
  return grants;
}

function isUserDeniedApp(app: AppInfo, context: ComputerUseContext): boolean {
  const bundleId = app.bundleId?.trim().toLowerCase();
  if (!bundleId) return false;
  return (context.deniedBundleIds ?? []).some((denied) => denied.trim().toLowerCase() === bundleId);
}

function buildComputerUseUserDeniedGuidance(
  denied: Array<{ requestedName: string; displayName: string }>
): string | undefined {
  if (denied.length === 0) return undefined;
  const names = denied.map((app) => `"${app.displayName}"`).join(", ");
  const one = denied.length === 1;
  return `${names} ${one ? "is" : "are"} in the user's Computer Use deny list. Requests for ${one ? "this app" : "these apps"} are automatically denied. Ask the user to remove ${one ? "it" : "them"} from Settings if access is needed; do not try to bypass this restriction.`;
}

function getMouseHoldState(context: ComputerUseContext): { held: boolean; moved: boolean } {
  const key = computerUseSessionKey(context);
  let state = mouseHoldStateBySession.get(key);
  if (!state) {
    state = { held: false, moved: false };
    mouseHoldStateBySession.set(key, state);
  }
  return state;
}

async function releaseHeldMouse(context: ComputerUseContext, force = false): Promise<void> {
  const state = getMouseHoldState(context);
  if (!force && !state.held) return;
  try {
    await helper("mouse_up", {}, context);
  } finally {
    state.held = false;
    state.moved = false;
  }
}

function computerUseSessionKey(context: ComputerUseContext): string {
  return context.sessionId || context.kiraWorkspaceRoot || context.cwd || "default";
}

function effectiveDisplayId(input: ComputerUseInput, context: ComputerUseContext): number | undefined {
  return input.displayId ?? selectedDisplaysBySession.get(computerUseSessionKey(context));
}

async function resolveScreenshotDisplayId(input: ComputerUseInput, context: ComputerUseContext): Promise<number | undefined> {
  if (input.displayId !== undefined) return input.displayId;
  const sessionKey = computerUseSessionKey(context);
  const selected = selectedDisplaysBySession.get(sessionKey);
  if (displayPinnedBySession.has(sessionKey)) return selected;

  const grants = [...grantStore(context).values()];
  const appSetKey = grants.map((grant) => grant.bundleId).filter(Boolean).sort().join(",");
  if (appSetKey && displayResolvedForAppsBySession.get(sessionKey) !== appSetKey) {
    const resolved = await resolveDisplayForGrantedApps(context, grants, selected);
    if (resolved !== undefined) {
      selectedDisplaysBySession.set(sessionKey, resolved);
      displayResolvedForAppsBySession.set(sessionKey, appSetKey);
      return resolved;
    }
    displayResolvedForAppsBySession.set(sessionKey, appSetKey);
  }

  return selected;
}

async function resolveDisplayForGrantedApps(
  context: ComputerUseContext,
  grants: AppGrant[],
  preferredDisplayId: number | undefined
): Promise<number | undefined> {
  const locations = await helper<Array<{ bundleId: string; displayIds: number[] }>>(
    "find_window_displays",
    { bundleIds: grants.map((grant) => grant.bundleId).filter(Boolean) },
    context,
    { timeoutMs: FAST_APP_LIST_TIMEOUT_MS }
  ).catch(() => []);
  const displayIds = [...new Set(locations.flatMap((location) => location.displayIds ?? []))];
  if (displayIds.length === 0) return preferredDisplayId;
  if (preferredDisplayId !== undefined && displayIds.includes(preferredDisplayId)) {
    return preferredDisplayId;
  }
  return displayIds[0];
}

function pinComputerUseDisplay(context: ComputerUseContext, displayId: number): void {
  const sessionKey = computerUseSessionKey(context);
  selectedDisplaysBySession.set(sessionKey, displayId);
  displayPinnedBySession.add(sessionKey);
  displayResolvedForAppsBySession.delete(sessionKey);
}

function clearComputerUseDisplaySelection(context: ComputerUseContext): void {
  const sessionKey = computerUseSessionKey(context);
  selectedDisplaysBySession.delete(sessionKey);
  displayPinnedBySession.delete(sessionKey);
  displayResolvedForAppsBySession.delete(sessionKey);
}

function isAutoDisplay(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "auto";
}

function resolveDisplay(input: ComputerUseInput, displays: DisplayGeometry[]): DisplayGeometry {
  if (displays.length === 0) {
    throw new ToolError("ComputerUse switch_display found no active displays", "command-failed");
  }
  if (input.displayId !== undefined) {
    const exact = displays.find((display) => displayIdentity(display) === input.displayId);
    if (exact) return exact;
    throw new ToolError(`ComputerUse switch_display could not find display ID ${input.displayId}`, "bad-input");
  }
  const requested = input.display?.trim();
  if (!requested) {
    throw new ToolError("ComputerUse switch_display requires display or displayId", "bad-input");
  }
  const numeric = Number(requested);
  if (Number.isInteger(numeric)) {
    const exact = displays.find((display) => displayIdentity(display) === numeric);
    if (exact) return exact;
  }
  const labels = uniqueDisplayLabels(displays);
  const needle = normalizeDisplayLabel(requested);
  const exact = displays.find((display) =>
    normalizeDisplayLabel(displayLabel(display, labels)) === needle
    || normalizeDisplayLabel(display.label) === needle
    || normalizeDisplayLabel(display.name) === needle
  );
  if (exact) return exact;
  const partial = displays.find((display) =>
    normalizeDisplayLabel(displayLabel(display, labels)).includes(needle)
    || normalizeDisplayLabel(display.label).includes(needle)
    || normalizeDisplayLabel(display.name).includes(needle)
  );
  if (partial) return partial;
  throw new ToolError(`ComputerUse switch_display could not find display "${requested}". Available displays: ${displays.map((display) => displayLabel(display, labels)).join(", ")}`, "bad-input");
}

function uniqueDisplayLabels(displays: DisplayGeometry[]): Map<number, string> {
  const sorted = [...displays].sort((a, b) => displayIdentity(a) - displayIdentity(b));
  const counts = new Map<string, number>();
  const labels = new Map<number, string>();
  for (const display of sorted) {
    const base = display.label || display.name || `Display ${displayIdentity(display)}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    labels.set(displayIdentity(display), count === 1 ? base : `${base} (${count})`);
  }
  return labels;
}

function displayIdentity(display: DisplayGeometry): number {
  return display.displayId ?? display.id ?? 0;
}

function displayLabel(display: DisplayGeometry, labels?: Map<number, string>): string {
  return labels?.get(displayIdentity(display)) || display.label || display.name || `Display ${displayIdentity(display)}`;
}

function normalizeDisplayLabel(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

async function buildMonitorNote(
  context: ComputerUseContext,
  screenshot: ScreenshotResult,
  previousScreenshot: ScreenshotResult | undefined
): Promise<string | undefined> {
  const displays = await helper<DisplayGeometry[]>("list_displays", {}, context).catch(() => [] as DisplayGeometry[]);
  if (displays.length < 2) return undefined;
  const labels = uniqueDisplayLabels(displays);
  const currentId = screenshot.displayId ?? screenshot.display?.displayId ?? screenshot.display?.id;
  if (currentId === undefined) return undefined;
  const currentDisplay = displays.find((display) => displayIdentity(display) === currentId) ?? screenshot.display;
  const currentLabel = currentDisplay ? displayLabel(currentDisplay, labels) : `Display ${currentId}`;
  const others = displays
    .filter((display) => displayIdentity(display) !== currentId)
    .map((display) => displayLabel(display, labels));
  const switchHint = others.length > 0
    ? ` Other attached monitors: ${others.map((label) => `"${label}"`).join(", ")}. Use switch_display to capture a different monitor.`
    : "";
  const previousId = previousScreenshot?.displayId ?? previousScreenshot?.display?.displayId ?? previousScreenshot?.display?.id;
  if (previousId === undefined || previousId === currentId) {
    return `This screenshot was taken on monitor "${currentLabel}".${switchHint}`;
  }
  const previousDisplay = displays.find((display) => displayIdentity(display) === previousId);
  const previousLabel = previousDisplay ? displayLabel(previousDisplay, labels) : `Display ${previousId}`;
  return `This screenshot was taken on monitor "${currentLabel}", which is different from your previous screenshot on "${previousLabel}".${switchHint}`;
}

function getLastScreenshot(context: ComputerUseContext): ScreenshotResult | undefined {
  return screenshotsBySession.get(computerUseSessionKey(context));
}

function setLastScreenshot(context: ComputerUseContext, screenshot: ScreenshotResult | undefined): void {
  const key = computerUseSessionKey(context);
  if (screenshot) {
    screenshotsBySession.set(key, screenshot);
  } else {
    screenshotsBySession.delete(key);
  }
}

async function wait(durationMs: number): Promise<void> {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 100_000) {
    throw new ToolError("ComputerUse wait durationMs must be between 0 and 100000", "bad-input");
  }
  await delay(durationMs);
}

function firstResultLine(output: string): string {
  return output.split("\n")[0] ?? "";
}

function parseBatchResultPayload(output: string): { completed: ComputerUseBatchActionResult[]; failed?: ComputerUseBatchActionResult; remaining?: number } | undefined {
  return parseFirstJsonObject(output) as { completed: ComputerUseBatchActionResult[]; failed?: ComputerUseBatchActionResult; remaining?: number } | undefined;
}

function parseAccessResultPayload(output: string): { granted?: AppGrant[] } | undefined {
  return parseFirstJsonObject(output) as { granted?: AppGrant[] } | undefined;
}

function parseTeachStepResultPayload(output: string): { executed: number; results?: ComputerUseBatchActionResult[]; failed?: ComputerUseBatchActionResult; remaining?: number; exited?: boolean } | undefined {
  return parseFirstJsonObject(output) as { executed: number; results?: ComputerUseBatchActionResult[]; failed?: ComputerUseBatchActionResult; remaining?: number; exited?: boolean } | undefined;
}

function parseFirstJsonObject(output: string): unknown | undefined {
  const trimmed = output.trimStart();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const end = trimmed.indexOf("\n\n");
    if (end < 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(0, end));
    } catch {
      return undefined;
    }
  }
}

async function typeTextByGrapheme(text: string, context: ComputerUseContext): Promise<void> {
  const graphemes = segmentGraphemes(text);
  for (const [index, grapheme] of graphemes.entries()) {
    if (context.signal?.aborted) {
      throw new ToolError(
        `Typing aborted after ${index} of ${graphemes.length} graphemes (user interrupt).`,
        "command-failed"
      );
    }
    await delay(INTER_GRAPHEME_SLEEP_MS);
    if (grapheme === "\n" || grapheme === "\r" || grapheme === "\r\n") {
      await helper("key", { keySequence: "return", repeat: 1 }, context);
    } else if (grapheme === "\t") {
      await helper("key", { keySequence: "tab", repeat: 1 }, context);
    } else {
      await helper("type", { text: grapheme }, context);
    }
  }
}

function segmentGraphemes(text: string): string[] {
  try {
    const Segmenter = (
      Intl as typeof Intl & {
        Segmenter?: new (
          locale?: string,
          options?: { granularity: "grapheme" | "word" | "sentence" }
        ) => { segment: (value: string) => Iterable<{ segment: string }> };
      }
    ).Segmenter;
    if (typeof Segmenter === "function") {
      const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(segmenter.segment(text), (item) => item.segment);
    }
  } catch {
    // Fall back to code-point iteration below.
  }
  return Array.from(text);
}

async function helper<T>(
  command: string,
  payload: Record<string, unknown>,
  context: ComputerUseContext,
  options?: { timeoutMs?: number }
): Promise<T> {
  return callComputerUseHelper<T>({
    command,
    payload,
    cwd: context.cwd,
    kiraWorkspaceRoot: context.kiraWorkspaceRoot,
    env: context.env,
    signal: context.signal,
    timeoutMs: options?.timeoutMs
  });
}

function formatScreenshot(result: ScreenshotResult, input: ComputerUseInput, cwd: string): string {
  if (input.save_to_disk === true) {
    result.filePath = saveImageFile(result.base64, cwd, "screen");
  }
  const display = result.display;
  const lines = [
    input.save_to_disk === true ? `Screenshot saved: ${result.filePath}` : undefined,
    input.save_to_disk === true ? "Format: jpg" : undefined,
    `Image size sent to model: ${result.width}x${result.height}`,
    `Display ID: ${result.displayId ?? display?.displayId ?? display?.id ?? "unknown"}`,
    result.monitorNote,
    "Click coordinates should be pixels from this screenshot image. Kira handles all display scaling."
  ].filter((line): line is string => Boolean(line));
  if (input.includeImage !== false) {
    lines.push("", `<<MAGI_IMAGE:image/jpeg|${result.base64}:MAGI_IMAGE>>`);
  }
  return lines.join("\n");
}

function formatZoom(result: ZoomResult, input: ComputerUseInput, cwd: string): string {
  const filePath = input.save_to_disk === true ? saveImageFile(result.base64, cwd, "zoom") : undefined;
  const lines = [
    filePath ? `Zoom saved: ${filePath}` : undefined,
    filePath ? "Format: jpg" : undefined,
    `Zoom image size sent to model: ${result.width}x${result.height}`,
    `Source region in previous screenshot: (${input.x}, ${input.y}) ${input.width}x${input.height}`,
    "Click coordinates still refer to the full screenshot, not this zoomed image."
  ].filter((line): line is string => Boolean(line));
  if (input.includeImage !== false) {
    lines.push("", `<<MAGI_IMAGE:image/jpeg|${result.base64}:MAGI_IMAGE>>`);
  }
  return lines.join("\n");
}

function saveImageFile(base64: string, cwd: string, prefix: "screen" | "zoom"): string {
  const dir = path.join(cwd, "artifacts", "screenshots");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

function scalePoint(rawX: number, rawY: number, context: ComputerUseContext): Point {
  const lastScreenshot = getLastScreenshot(context);
  if (!lastScreenshot) {
    return { x: Math.round(rawX), y: Math.round(rawY) };
  }
  return {
    x: Math.round(rawX * (lastScreenshot.displayWidth / lastScreenshot.width)) + (lastScreenshot.originX ?? 0),
    y: Math.round(rawY * (lastScreenshot.displayHeight / lastScreenshot.height)) + (lastScreenshot.originY ?? 0)
  };
}

function scaleRegion(rawX: number, rawY: number, rawWidth: number, rawHeight: number, context: ComputerUseContext): { x: number; y: number; width: number; height: number } {
  const origin = scalePoint(rawX, rawY, context);
  const lastScreenshot = getLastScreenshot(context);
  if (!lastScreenshot) {
    return { ...origin, width: Math.round(rawWidth), height: Math.round(rawHeight) };
  }
  return {
    ...origin,
    width: Math.max(Math.round(rawWidth * (lastScreenshot.displayWidth / lastScreenshot.width)), 1),
    height: Math.max(Math.round(rawHeight * (lastScreenshot.displayHeight / lastScreenshot.height)), 1)
  };
}

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function formatPermissions(value: Record<string, unknown>): string {
  const screen = value.screenRecording;
  const accessibility = value.accessibility;
  const granted = accessibility === true && screen === true;
  const uncertain = accessibility !== true || screen !== true;
  return [
    `Computer Use setup check: ${granted ? "ready" : "check settings"}`,
    `Accessibility: ${accessibility === true ? "ready" : "check settings"}`,
    `Screen Recording: ${screen === true ? "ready" : "check settings"}`,
    "",
    uncertain
      ? "This check is best-effort on macOS and can be stale after app updates. Do not loop on this check during a task; try the requested Computer Use action once and report the exact runtime error if it fails."
      : "Computer Use can attempt screen observation and desktop control."
  ].join("\n");
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function screenshotFilteringMode(): "native" | "none" {
  return os.platform() === "darwin" ? "native" : "none";
}

function asComputerUseError(error: unknown, action: ComputerUseAction): ToolError {
  if (error instanceof ToolError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/dependency install|pip |venv|ensurepip|No module named|ModuleNotFoundError|Python venv/i.test(message)) {
    return new ToolError([
      "Kira could not prepare the Computer Use runtime.",
      "The Python helper dependencies need to be installed inside the selected Kira Workspace before desktop control can run.",
      "",
      `System detail: ${message}`
    ].join("\n"), "command-failed");
  }
  const isScreenshot = action === "screenshot";
  return new ToolError([
    isScreenshot ? "Kira cannot observe the screen right now." : "Kira cannot control the computer right now.",
    "If this is the first time using Computer Use, complete Mac Permissions in Settings once, restart Kira, then retry. If permissions were already granted, do not ask again; report the system detail below and suggest restarting Kira or removing/re-adding Kira in macOS privacy settings.",
    "",
    `System detail: ${message}`
  ].join("\n"), "command-failed");
}

function validateComputerUseInput(input: ComputerUseInput): void {
  if (["click", "double_click", "triple_click", "right_click", "middle_click", "move", "app_under_point"].includes(input.action)) {
    requireCoordinate(input.x, "x");
    requireCoordinate(input.y, "y");
  }
  if (input.action === "zoom") {
    requireCoordinate(input.x, "x");
    requireCoordinate(input.y, "y");
    requirePositiveDimension(input.width, "width");
    requirePositiveDimension(input.height, "height");
  }
  if (input.action === "switch_display" && !isAutoDisplay(input.display) && input.displayId === undefined && !input.display) {
    throw new ToolError("ComputerUse switch_display requires display, displayId, or display='auto'", "bad-input");
  }
  if (input.action === "scroll") {
    requireCoordinate(input.x, "x");
    requireCoordinate(input.y, "y");
    if (input.deltaX === undefined && input.deltaY === undefined) {
      throw new ToolError("ComputerUse scroll requires deltaX or deltaY", "bad-input");
    }
    if (typeof input.deltaX === "number" && (!Number.isInteger(input.deltaX) || Math.abs(input.deltaX) > 100)) {
      throw new ToolError("ComputerUse scroll deltaX must be an integer between -100 and 100", "bad-input");
    }
    if (typeof input.deltaY === "number" && (!Number.isInteger(input.deltaY) || Math.abs(input.deltaY) > 100)) {
      throw new ToolError("ComputerUse scroll deltaY must be an integer between -100 and 100", "bad-input");
    }
  }
  if (input.action === "drag") {
    if (input.x !== undefined || input.y !== undefined) {
      requireCoordinate(input.x, "x");
      requireCoordinate(input.y, "y");
    }
    requireCoordinate(input.toX, "toX");
    requireCoordinate(input.toY, "toY");
  }
  if (input.action === "type" && input.text === undefined) {
    throw new ToolError("ComputerUse type action requires text", "bad-input");
  }
  if (input.action === "write_clipboard" && input.text === undefined) {
    throw new ToolError("ComputerUse write_clipboard action requires text", "bad-input");
  }
  if (input.action === "key") {
    if (!input.key) {
      throw new ToolError("ComputerUse key action requires key", "bad-input");
    }
    if (input.repeat !== undefined && (!Number.isInteger(input.repeat) || input.repeat < 1 || input.repeat > 100)) {
      throw new ToolError("ComputerUse key repeat must be an integer between 1 and 100", "bad-input");
    }
  }
  if (input.action === "hold_key") {
    if (!input.key) {
      throw new ToolError("ComputerUse hold_key action requires key", "bad-input");
    }
    if (input.durationMs === undefined) {
      throw new ToolError("ComputerUse duration must be a number", "bad-input");
    }
    if (input.durationMs !== undefined && (input.durationMs < 0 || input.durationMs > 100_000)) {
      throw new ToolError("ComputerUse hold_key durationMs must be between 0 and 100000", "bad-input");
    }
  }
  if (input.action === "hotkey" && (!input.keys || input.keys.length < 2)) {
    throw new ToolError("ComputerUse hotkey action requires at least two keys", "bad-input");
  }
  if (input.action === "open_app" && !input.bundleId && !input.app) {
    throw new ToolError("ComputerUse open_app requires app or bundleId", "bad-input");
  }
  if (input.action === "request_access") {
    if (!input.apps || input.apps.length === 0) {
      throw new ToolError("ComputerUse request_access requires apps", "bad-input");
    }
    if (!input.reason) {
      throw new ToolError("ComputerUse request_access requires reason", "bad-input");
    }
  }
  if (input.action === "request_teach_access") {
    if (!input.apps || input.apps.length === 0) {
      throw new ToolError("ComputerUse request_teach_access requires apps", "bad-input");
    }
    if (!input.reason) {
      throw new ToolError("ComputerUse request_teach_access requires reason", "bad-input");
    }
  }
  if (input.action === "wait") {
    if (input.durationMs === undefined) {
      throw new ToolError("ComputerUse duration must be a number", "bad-input");
    }
    if (input.durationMs !== undefined && (input.durationMs < 0 || input.durationMs > 100_000)) {
      throw new ToolError("ComputerUse wait durationMs must be between 0 and 100000", "bad-input");
    }
  }
  if (input.action === "batch") {
    if (!input.actions || input.actions.length === 0) {
      throw new ToolError("ComputerUse batch requires at least one action", "bad-input");
    }
    if (input.actions.length > 25) {
      throw new ToolError("ComputerUse batch supports at most 25 actions", "bad-input");
    }
    for (const action of input.actions) {
      validateComputerUseInput({ ...action, includePostActionScreenshot: false });
    }
  }
  if (input.action === "teach_step") {
    inputToTeachStep(input, "teach_step");
  }
  if (input.action === "teach_batch") {
    if (!input.steps || input.steps.length === 0) {
      throw new ToolError("ComputerUse teach_batch requires at least one step", "bad-input");
    }
    if (input.steps.length > 25) {
      throw new ToolError("ComputerUse teach_batch supports at most 25 steps", "bad-input");
    }
    for (const [index, step] of input.steps.entries()) {
      inputToTeachStep({ action: "teach_step", ...step }, `steps[${index}]`);
    }
  }
}

function inputToTeachStep(input: ComputerUseInput, label: string): ComputerUseTeachStep {
  const nextPreview = input.nextPreview ?? input.next_preview;
  if (!input.explanation) {
    throw new ToolError(`ComputerUse ${label} requires explanation`, "bad-input");
  }
  if (!nextPreview) {
    throw new ToolError(`ComputerUse ${label} requires next_preview`, "bad-input");
  }
  if (!input.actions) {
    throw new ToolError(`ComputerUse ${label} requires actions`, "bad-input");
  }
  if (input.actions.length > 25) {
    throw new ToolError(`ComputerUse ${label} supports at most 25 actions`, "bad-input");
  }
  for (const action of input.actions) {
    validateComputerUseInput({ ...action, includePostActionScreenshot: false });
  }
  return {
    explanation: input.explanation,
    nextPreview,
    anchor: input.anchor,
    actions: input.actions
  };
}

function normalizeComputerUseInputShape(input: Record<string, unknown>): Record<string, unknown> {
  const action = normalizeComputerUseAction(input.action);
  const normalized: Record<string, unknown> = { ...input, action };

  if (action === "drag") {
    applyCoordinateAlias(normalized, "start_coordinate", "x", "y");
    applyCoordinateAlias(normalized, "coordinate", "toX", "toY");
  } else {
    applyCoordinateAlias(normalized, "coordinate", "x", "y");
  }
  if (action === "zoom" && Array.isArray(input.region)) {
    const [x0, y0, x1, y1] = readNumberTuple(input.region, "region", 4);
    normalized.x ??= x0;
    normalized.y ??= y0;
    normalized.width ??= Math.max(x1 - x0, 1);
    normalized.height ??= Math.max(y1 - y0, 1);
  }
  if ((action === "key" || action === "hold_key") && typeof input.text === "string" && normalized.key === undefined) {
    normalized.key = input.text;
  }
  if (action === "hotkey" && typeof input.text === "string" && normalized.keys === undefined) {
    normalized.keys = input.text.split("+").map((part) => part.trim()).filter(Boolean);
  }
  if ((action === "wait" || action === "hold_key") && input.duration !== undefined) {
    const duration = validateMagiDurationSeconds(input.duration);
    if (normalized.durationMs === undefined) {
      normalized.durationMs = Math.round(duration * 1000);
    }
  }
  if (action === "scroll") {
    const amount = typeof input.scroll_amount === "number" ? input.scroll_amount : 0;
    if (!Number.isInteger(amount) || amount < 0 || amount > 100) {
      throw new ToolError("ComputerUse scroll_amount must be an integer between 0 and 100", "bad-input");
    }
    if (typeof input.scroll_direction === "string") {
      const direction = input.scroll_direction.toLowerCase();
      if (direction === "up" && normalized.deltaY === undefined) normalized.deltaY = -amount;
      if (direction === "down" && normalized.deltaY === undefined) normalized.deltaY = amount;
      if (direction === "left" && normalized.deltaX === undefined) normalized.deltaX = -amount;
      if (direction === "right" && normalized.deltaX === undefined) normalized.deltaX = amount;
    }
  }
  if ((action === "batch" || action === "teach_step") && Array.isArray(input.actions)) {
    normalized.actions = input.actions.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? normalizeComputerUseInputShape(item as Record<string, unknown>)
        : item
    );
  }
  if (action === "teach_batch" && Array.isArray(input.steps)) {
    normalized.steps = input.steps.map((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return step;
      const raw = step as Record<string, unknown>;
      return {
        ...raw,
        actions: Array.isArray(raw.actions)
          ? raw.actions.map((item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? normalizeComputerUseInputShape(item as Record<string, unknown>)
              : item
          )
          : raw.actions
      };
    });
  }

  return normalized;
}

function normalizeComputerUseAction(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const aliases: Record<ComputerUseActionAlias, ComputerUseAction> = {
    left_click: "click",
    mouse_move: "move",
    left_click_drag: "drag",
    open_application: "open_app",
    list_granted_applications: "list_granted_apps",
    computer_batch: "batch"
  };
  return isComputerUseActionAlias(value) ? aliases[value] : value;
}

function applyCoordinateAlias(
  input: Record<string, unknown>,
  source: string,
  xName: string,
  yName: string
): void {
  if (!Array.isArray(input[source])) return;
  const [x, y] = readNumberTuple(input[source], source, 2);
  input[xName] ??= x;
  input[yName] ??= y;
}

function readNumberTuple(value: unknown, name: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new ToolError(`ComputerUse ${name} must be a ${length}-number tuple`, "bad-input");
  }
  return value;
}

function isComputerUseRawAction(value: unknown): value is ComputerUseAction | ComputerUseActionAlias {
  return isComputerUseAction(value) || isComputerUseActionAlias(value);
}

function isComputerUseActionAlias(value: unknown): value is ComputerUseActionAlias {
  return typeof value === "string" && [
    "left_click",
    "mouse_move",
    "left_click_drag",
    "open_application",
    "list_granted_applications",
    "computer_batch"
  ].includes(value);
}

function isComputerUseAction(value: unknown): value is ComputerUseAction {
  return typeof value === "string" && [
    "screenshot",
    "zoom",
    "display_info",
    "switch_display",
    "permissions",
    "cursor_position",
    "frontmost_app",
    "app_under_point",
    "request_access",
    "request_teach_access",
    "list_granted_apps",
    "list_running_apps",
    "list_installed_apps",
    "open_app",
    "click",
    "double_click",
    "triple_click",
    "right_click",
    "middle_click",
    "move",
    "drag",
    "left_mouse_down",
    "left_mouse_up",
    "scroll",
    "type",
    "key",
    "hold_key",
    "hotkey",
    "read_clipboard",
    "write_clipboard",
    "wait",
    "batch",
    "teach_step",
    "teach_batch"
  ].includes(value);
}

function isComputerUseBatchAction(value: unknown): value is ComputerUseBatchAction {
  const normalized = normalizeComputerUseAction(value);
  return isComputerUseAction(normalized)
    && NORMALIZED_COMPUTER_USE_BATCH_ACTIONS.has(normalized as ComputerUseBatchAction)
    && value !== "batch"
    && value !== "computer_batch"
    && value !== "display_info"
    && value !== "switch_display"
    && value !== "permissions"
    && value !== "request_access"
    && value !== "request_teach_access"
    && value !== "list_granted_apps"
    && value !== "list_granted_applications"
    && value !== "list_running_apps"
    && value !== "list_installed_apps"
    && value !== "open_app"
    && value !== "open_application"
    && value !== "read_clipboard"
    && value !== "write_clipboard"
    && value !== "teach_step"
    && value !== "teach_batch"
    && normalized !== "batch"
    && normalized !== "display_info"
    && normalized !== "switch_display"
    && normalized !== "permissions"
    && normalized !== "request_access"
    && normalized !== "request_teach_access"
    && normalized !== "list_granted_apps"
    && normalized !== "list_running_apps"
    && normalized !== "list_installed_apps"
    && normalized !== "open_app"
    && normalized !== "hotkey"
    && normalized !== "read_clipboard"
    && normalized !== "write_clipboard"
    && normalized !== "teach_step"
    && normalized !== "teach_batch";
}

function requireCoordinate(value: number | undefined, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolError(`ComputerUse ${name} must be a finite number`, "bad-input");
  }
}

function requirePositiveDimension(value: number | undefined, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ToolError(`ComputerUse ${name} must be a positive number`, "bad-input");
  }
}

function validateMagiDurationSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolError("ComputerUse duration must be a number", "bad-input");
  }
  if (value < 0) {
    throw new ToolError("ComputerUse duration must be non-negative", "bad-input");
  }
  if (value > 100) {
    throw new ToolError("ComputerUse duration is too long. Duration is in seconds.", "bad-input");
  }
  return value;
}

function readOptionalNumber(input: Record<string, unknown>, name: string): number | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolError(`ComputerUse ${name} must be a number`, "bad-input");
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolError(`ComputerUse ${name} must be a string`, "bad-input");
  }
  return value;
}

function readOptionalBoolean(input: Record<string, unknown>, name: string): boolean | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ToolError(`ComputerUse ${name} must be a boolean`, "bad-input");
  }
  return value;
}

function readOptionalStringArray(input: Record<string, unknown>, name: string): string[] | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ToolError(`ComputerUse ${name} must be a string array`, "bad-input");
  }
  return value;
}

function readOptionalAnchor(input: Record<string, unknown>, name: string): [number, number] | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number" || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new ToolError(`ComputerUse ${name} must be a [x, y] number tuple`, "bad-input");
  }
  return [value[0], value[1]];
}

function readOptionalBatchActions(input: Record<string, unknown>, name: string): ComputerUseBatchItem[] | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ToolError(`ComputerUse ${name} must be an action array`, "bad-input");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ToolError(`ComputerUse actions[${index}] must be an object`, "bad-input");
    }
    const raw = item as Record<string, unknown>;
    const action = raw.action;
    if (!isComputerUseBatchAction(action)) {
      throw new ToolError(`ComputerUse actions[${index}].action is unsupported: ${String(action)}`, "bad-input");
    }
    return {
      action,
      x: readOptionalNumber(raw, "x"),
      y: readOptionalNumber(raw, "y"),
      toX: readOptionalNumber(raw, "toX"),
      toY: readOptionalNumber(raw, "toY"),
      deltaX: readOptionalNumber(raw, "deltaX"),
      deltaY: readOptionalNumber(raw, "deltaY"),
      text: readOptionalString(raw, "text"),
      key: readOptionalString(raw, "key"),
      keys: readOptionalStringArray(raw, "keys"),
      app: readOptionalString(raw, "app"),
      bundleId: readOptionalString(raw, "bundleId"),
      durationMs: readOptionalNumber(raw, "durationMs"),
      repeat: readOptionalNumber(raw, "repeat"),
      viaClipboard: readOptionalBoolean(raw, "viaClipboard")
    };
  });
}

function readOptionalTeachSteps(input: Record<string, unknown>, name: string): ComputerUseTeachStep[] | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ToolError(`ComputerUse ${name} must be a teach step array`, "bad-input");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ToolError(`ComputerUse steps[${index}] must be an object`, "bad-input");
    }
    const raw = item as Record<string, unknown>;
    const explanation = readOptionalString(raw, "explanation");
    const nextPreview = readOptionalString(raw, "nextPreview") ?? readOptionalString(raw, "next_preview");
    const actions = readOptionalBatchActions(raw, "actions");
    if (!explanation) {
      throw new ToolError(`ComputerUse steps[${index}] requires explanation`, "bad-input");
    }
    if (!nextPreview) {
      throw new ToolError(`ComputerUse steps[${index}] requires next_preview`, "bad-input");
    }
    if (!actions) {
      throw new ToolError(`ComputerUse steps[${index}] requires actions`, "bad-input");
    }
    return {
      explanation,
      nextPreview,
      anchor: readOptionalAnchor(raw, "anchor"),
      actions
    };
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

interface ResizeParams {
  pxPerToken: number;
  maxTargetPx: number;
  maxTargetTokens: number;
}

function targetImageSize(width: number, height: number, params: ResizeParams): [number, number] {
  const { pxPerToken, maxTargetPx, maxTargetTokens } = params;
  if (
    width <= maxTargetPx
    && height <= maxTargetPx
    && nTokensForImg(width, height, pxPerToken) <= maxTargetTokens
  ) {
    return [width, height];
  }
  if (height > width) {
    const [w, h] = targetImageSize(height, width, params);
    return [h, w];
  }
  const aspectRatio = width / height;
  let upperBoundWidth = width;
  let lowerBoundWidth = 1;
  for (;;) {
    if (lowerBoundWidth + 1 === upperBoundWidth) {
      return [lowerBoundWidth, Math.max(Math.round(lowerBoundWidth / aspectRatio), 1)];
    }
    const middleWidth = Math.floor((lowerBoundWidth + upperBoundWidth) / 2);
    const middleHeight = Math.max(Math.round(middleWidth / aspectRatio), 1);
    if (
      middleWidth <= maxTargetPx
      && nTokensForImg(middleWidth, middleHeight, pxPerToken) <= maxTargetTokens
    ) {
      lowerBoundWidth = middleWidth;
    } else {
      upperBoundWidth = middleWidth;
    }
  }
}

function nTokensForImg(width: number, height: number, pxPerToken: number): number {
  return nTokensForPx(width, pxPerToken) * nTokensForPx(height, pxPerToken);
}

function nTokensForPx(px: number, pxPerToken: number): number {
  return Math.floor((px - 1) / pxPerToken) + 1;
}
