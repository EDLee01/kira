import * as fs from "fs";
import * as path from "path";
import { MagiPaths } from "../core/paths.ts";

export type DesktopSettings = Record<string, string>;

export function desktopSettingsFile(paths: MagiPaths): string {
  return path.join(paths.stateRoot, "desktop-settings.json");
}

export function readDesktopSettings(paths: MagiPaths): DesktopSettings {
  try {
    return JSON.parse(fs.readFileSync(desktopSettingsFile(paths), "utf-8"));
  } catch {
    return {};
  }
}

export function writeDesktopSettings(paths: MagiPaths, settings: DesktopSettings): void {
  const file = desktopSettingsFile(paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

export function applyDesktopSettingsToEnv(settings: DesktopSettings): void {
  if (settings.apiKey) process.env["ANTHROPIC_AUTH_TOKEN"] = settings.apiKey;
  if (settings.baseUrl) process.env["ANTHROPIC_BASE_URL"] = settings.baseUrl;
  if (settings.model) process.env["ANTHROPIC_MODEL"] = settings.model;
}
