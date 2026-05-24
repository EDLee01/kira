import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { ToolError } from "./errors.ts";

const execFileAsync = promisify(execFile);

export type ComputerUseAction =
  | "screenshot"
  | "click"
  | "double_click"
  | "right_click"
  | "move"
  | "drag"
  | "type"
  | "key"
  | "hotkey";

export interface ComputerUseInput {
  action: ComputerUseAction;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  text?: string;
  key?: string;
  keys?: string[];
  format?: "png" | "jpg";
  includeImage?: boolean;
}

export const ComputerUseInputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["screenshot", "click", "double_click", "right_click", "move", "drag", "type", "key", "hotkey"],
      description: "Desktop action to perform. screenshot is read-only; input actions require user approval."
    },
    x: { type: "number", description: "Screen X coordinate for mouse actions." },
    y: { type: "number", description: "Screen Y coordinate for mouse actions." },
    toX: { type: "number", description: "Destination X coordinate for drag actions." },
    toY: { type: "number", description: "Destination Y coordinate for drag actions." },
    text: { type: "string", description: "Text to type for the type action." },
    key: { type: "string", description: "Key name for the key action, e.g. enter, escape, tab, space, left, right, up, down, delete." },
    keys: {
      type: "array",
      items: { type: "string" },
      description: "Keys for a hotkey action, e.g. ['command','space'] or ['command','shift','4']."
    },
    format: {
      type: "string",
      enum: ["png", "jpg"],
      description: "Screenshot format. Defaults to png."
    },
    includeImage: {
      type: "boolean",
      description: "For screenshot, include a base64 data URL in the tool result. Defaults to true."
    }
  },
  required: ["action"],
  additionalProperties: false
} satisfies Record<string, unknown>;

export function parseComputerUseInput(input: Record<string, unknown>): ComputerUseInput {
  const action = input.action;
  if (!isComputerUseAction(action)) {
    throw new ToolError("ComputerUse action must be screenshot, click, double_click, right_click, move, drag, type, key, or hotkey", "bad-input");
  }
  const parsed: ComputerUseInput = {
    action,
    x: readOptionalNumber(input, "x"),
    y: readOptionalNumber(input, "y"),
    toX: readOptionalNumber(input, "toX"),
    toY: readOptionalNumber(input, "toY"),
    text: readOptionalString(input, "text"),
    key: readOptionalString(input, "key"),
    keys: readOptionalStringArray(input, "keys"),
    format: readOptionalFormat(input),
    includeImage: readOptionalBoolean(input, "includeImage")
  };
  validateComputerUseInput(parsed);
  return parsed;
}

export async function executeComputerUse(input: ComputerUseInput, context: { cwd: string }): Promise<string> {
  if (os.platform() !== "darwin") {
    throw new ToolError(`ComputerUse currently supports macOS only; current platform is ${os.platform()}`, "command-failed");
  }

  switch (input.action) {
    case "screenshot":
      return takeScreenshot(input, context.cwd);
    case "click":
      await runMouseEvent("click", input, context.cwd);
      return `Clicked at (${input.x}, ${input.y}).`;
    case "double_click":
      await runMouseEvent("double_click", input, context.cwd);
      return `Double-clicked at (${input.x}, ${input.y}).`;
    case "right_click":
      await runMouseEvent("right_click", input, context.cwd);
      return `Right-clicked at (${input.x}, ${input.y}).`;
    case "move":
      await runMouseEvent("move", input, context.cwd);
      return `Moved pointer to (${input.x}, ${input.y}).`;
    case "drag":
      await runMouseEvent("drag", input, context.cwd);
      return `Dragged from (${input.x}, ${input.y}) to (${input.toX}, ${input.toY}).`;
    case "type":
      await runAppleScript(`tell application "System Events" to keystroke ${quoteAppleScriptString(input.text ?? "")}`);
      return `Typed ${JSON.stringify(truncate(input.text ?? "", 120))}.`;
    case "key":
      await runKey(input.key ?? "");
      return `Pressed key ${input.key}.`;
    case "hotkey":
      await runHotkey(input.keys ?? []);
      return `Pressed hotkey ${(input.keys ?? []).join("+")}.`;
  }
}

export function formatComputerUseResult(result: string): string {
  return result;
}

async function takeScreenshot(input: ComputerUseInput, cwd: string): Promise<string> {
  const format = input.format ?? "png";
  const dir = path.join(cwd, "artifacts", "screenshots");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `screen-${Date.now()}.${format}`);
  await execFileAsync("screencapture", ["-x", "-t", format, filePath], { timeout: 15_000 });
  if (!existsSync(filePath)) {
    throw new ToolError(`Screenshot file was not created at ${filePath}`, "command-failed");
  }
  const lines = [
    `Screenshot saved: ${filePath}`,
    `Format: ${format}`,
    "Coordinate origin: top-left of the main screen."
  ];
  if (input.includeImage !== false) {
    const mime = format === "jpg" ? "image/jpeg" : "image/png";
    const data = readFileSync(filePath).toString("base64");
    lines.push("", `<<MAGI_IMAGE:${mime}|${data}:MAGI_IMAGE>>`);
  }
  return lines.join("\n");
}

async function runMouseEvent(action: "click" | "double_click" | "right_click" | "move" | "drag", input: ComputerUseInput, cwd: string): Promise<void> {
  const tempDir = path.join(cwd, "tmp", "computer-use");
  mkdirSync(tempDir, { recursive: true });
  const scriptPath = path.join(tempDir, `${randomUUID()}.swift`);
  writeFileSync(scriptPath, mouseSwiftSource(), "utf8");
  const args = [
    scriptPath,
    action,
    String(input.x ?? 0),
    String(input.y ?? 0),
    String(input.toX ?? 0),
    String(input.toY ?? 0)
  ];
  try {
    await execFileAsync("swift", args, { timeout: 15_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolError([
      `Computer mouse control failed: ${message}`,
      "On macOS, Kira may need Accessibility permission in System Settings > Privacy & Security > Accessibility."
    ].join("\n"), "command-failed");
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {}
  }
}

function mouseSwiftSource(): string {
  return `
import CoreGraphics
import Foundation

func postMouse(_ type: CGEventType, _ x: Double, _ y: Double, _ button: CGMouseButton = .left) {
  let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: button)
  event?.post(tap: .cghidEventTap)
}

let args = CommandLine.arguments
if args.count < 4 {
  fputs("Usage: swift mouse.swift action x y [toX toY]\\n", stderr)
  exit(2)
}
let action = args[1]
let x = Double(args[2]) ?? 0
let y = Double(args[3]) ?? 0
let toX = args.count > 4 ? (Double(args[4]) ?? x) : x
let toY = args.count > 5 ? (Double(args[5]) ?? y) : y

switch action {
case "move":
  postMouse(.mouseMoved, x, y)
case "click":
  postMouse(.leftMouseDown, x, y)
  usleep(50_000)
  postMouse(.leftMouseUp, x, y)
case "double_click":
  for _ in 0..<2 {
    postMouse(.leftMouseDown, x, y)
    usleep(40_000)
    postMouse(.leftMouseUp, x, y)
    usleep(80_000)
  }
case "right_click":
  postMouse(.rightMouseDown, x, y, .right)
  usleep(50_000)
  postMouse(.rightMouseUp, x, y, .right)
case "drag":
  postMouse(.leftMouseDown, x, y)
  usleep(80_000)
  postMouse(.leftMouseDragged, toX, toY)
  usleep(80_000)
  postMouse(.leftMouseUp, toX, toY)
default:
  fputs("Unknown mouse action: \\(action)\\n", stderr)
  exit(2)
}
`;
}

async function runAppleScript(script: string): Promise<void> {
  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 15_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolError([
      `Computer control failed: ${message}`,
      "On macOS, Kira may need Accessibility permission in System Settings > Privacy & Security > Accessibility.",
      "Screenshots may also need Screen Recording permission."
    ].join("\n"), "command-failed");
  }
}

async function runKey(key: string): Promise<void> {
  const normalized = normalizeKeyName(key);
  const code = KEY_CODES[normalized];
  if (code !== undefined) {
    await runAppleScript(`tell application "System Events" to key code ${code}`);
    return;
  }
  if (normalized.length === 1) {
    await runAppleScript(`tell application "System Events" to keystroke ${quoteAppleScriptString(normalized)}`);
    return;
  }
  throw new ToolError(`Unsupported key: ${key}`, "bad-input");
}

async function runHotkey(keys: string[]): Promise<void> {
  if (keys.length < 2) {
    throw new ToolError("Hotkey requires at least two keys", "bad-input");
  }
  const normalized = keys.map(normalizeKeyName);
  const modifiers = normalized.filter((key) => MODIFIER_NAMES.has(key));
  const nonModifiers = normalized.filter((key) => !MODIFIER_NAMES.has(key));
  if (nonModifiers.length !== 1) {
    throw new ToolError("Hotkey requires exactly one non-modifier key", "bad-input");
  }
  const target = nonModifiers[0];
  const using = modifiers.length > 0
    ? ` using {${modifiers.map((key) => `${APPLE_MODIFIERS[key]} down`).join(", ")}}`
    : "";
  const code = KEY_CODES[target];
  if (code !== undefined) {
    await runAppleScript(`tell application "System Events" to key code ${code}${using}`);
    return;
  }
  if (target.length === 1) {
    await runAppleScript(`tell application "System Events" to keystroke ${quoteAppleScriptString(target)}${using}`);
    return;
  }
  throw new ToolError(`Unsupported hotkey target: ${target}`, "bad-input");
}

function validateComputerUseInput(input: ComputerUseInput): void {
  if (["click", "double_click", "right_click", "move"].includes(input.action)) {
    requireCoordinate(input.x, "x");
    requireCoordinate(input.y, "y");
  }
  if (input.action === "drag") {
    requireCoordinate(input.x, "x");
    requireCoordinate(input.y, "y");
    requireCoordinate(input.toX, "toX");
    requireCoordinate(input.toY, "toY");
  }
  if (input.action === "type" && input.text === undefined) {
    throw new ToolError("ComputerUse type action requires text", "bad-input");
  }
  if (input.action === "key" && !input.key) {
    throw new ToolError("ComputerUse key action requires key", "bad-input");
  }
  if (input.action === "hotkey" && (!input.keys || input.keys.length < 2)) {
    throw new ToolError("ComputerUse hotkey action requires at least two keys", "bad-input");
  }
}

function isComputerUseAction(value: unknown): value is ComputerUseAction {
  return typeof value === "string" && [
    "screenshot",
    "click",
    "double_click",
    "right_click",
    "move",
    "drag",
    "type",
    "key",
    "hotkey"
  ].includes(value);
}

function requireCoordinate(value: number | undefined, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ToolError(`ComputerUse ${name} must be a non-negative number`, "bad-input");
  }
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

function readOptionalFormat(input: Record<string, unknown>): "png" | "jpg" | undefined {
  const value = input.format;
  if (value === undefined) return undefined;
  if (value === "png" || value === "jpg") return value;
  throw new ToolError("ComputerUse format must be png or jpg", "bad-input");
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizeKeyName(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

const MODIFIER_NAMES = new Set(["command", "cmd", "shift", "option", "alt", "control", "ctrl"]);

const APPLE_MODIFIERS: Record<string, string> = {
  command: "command",
  cmd: "command",
  shift: "shift",
  option: "option",
  alt: "option",
  control: "control",
  ctrl: "control"
};

const KEY_CODES: Record<string, number> = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  command: 55,
  cmd: 55,
  shift: 56,
  caps_lock: 57,
  option: 58,
  alt: 58,
  control: 59,
  ctrl: 59,
  right: 124,
  left: 123,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  page_up: 116,
  page_down: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111
};
