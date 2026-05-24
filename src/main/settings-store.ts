import * as fs from "fs";
import * as path from "path";
import { MagiPaths } from "../core/paths.ts";
import { defaultKiraWorkspaceRoot } from "../core/kira-workspace.ts";
import { DesktopProviderKind, providerDefaults } from "./model-discovery";

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
  const provider = readProvider(settings.provider);
  const defaults = providerDefaults(provider);
  if (settings.apiKey) process.env[defaults.apiKeyEnv] = settings.apiKey;
  if (settings.baseUrl) process.env[defaults.baseUrlEnv] = settings.baseUrl;
  if (settings.model) process.env[defaults.modelEnv] = settings.model;
}

export function readKiraWorkspaceRoot(paths: MagiPaths): string {
  const settings = readDesktopSettings(paths);
  return settings.kiraWorkspaceRoot || defaultKiraWorkspaceRoot();
}

function readProvider(value: string | undefined): DesktopProviderKind {
  return value === "openai" || value === "openai-compatible" ? value : "anthropic";
}
