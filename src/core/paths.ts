import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { MagiConfigError } from "./errors.ts";

export const MAGI_ENV_PREFIX = "MAGI_";
export const DEVELOPMENT_ROOT_NAME = ".magi-next";
export const FUTURE_STABLE_ROOT_NAME = ".magi";
export const DEFAULT_CONTROL_BIND = "127.0.0.1";
export const DEFAULT_CONTROL_PORT = 8765;

export interface MagiPaths {
  root: string;
  configFile: string;
  stateRoot: string;
  sessionsRoot: string;
  logsRoot: string;
  cacheRoot: string;
  pluginsRoot: string;
  skillsRoot: string;
  devicesRoot: string;
  sessionDbFile: string;
}

export interface RuntimeSettings {
  controlBind: string;
  controlPort: number;
}

export function getMagiPaths(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): MagiPaths {
  const rawRoot = env.MAGI_CONFIG_DIR?.trim();
  const pathApi = selectPathApi(env, rawRoot, homeDir, env.USERPROFILE, env.HOME);
  const home = resolveHomeDir(env, homeDir, pathApi);
  const root = rawRoot
    ? pathApi.resolve(repairMissingRootSeparator(rawRoot, [homeDir, env.USERPROFILE, env.HOME], pathApi))
    : pathApi.join(home, DEVELOPMENT_ROOT_NAME);

  const stateRoot = pathApi.join(root, "state");

  return {
    root,
    configFile: pathApi.join(root, "config.yaml"),
    stateRoot,
    sessionsRoot: pathApi.join(root, "sessions"),
    logsRoot: pathApi.join(root, "logs"),
    cacheRoot: pathApi.join(root, "cache"),
    pluginsRoot: pathApi.join(root, "plugins"),
    skillsRoot: pathApi.join(root, "skills"),
    devicesRoot: pathApi.join(root, "devices"),
    sessionDbFile: pathApi.join(stateRoot, "sessions.sqlite")
  };
}

export function getRuntimeSettings(env: NodeJS.ProcessEnv = process.env): RuntimeSettings {
  return {
    controlBind: env.MAGI_CONTROL_BIND?.trim() || DEFAULT_CONTROL_BIND,
    controlPort: parseControlPort(env.MAGI_CONTROL_PORT)
  };
}

export function ensureMagiHome(paths: MagiPaths): void {
  for (const dir of [
    paths.root,
    paths.stateRoot,
    paths.sessionsRoot,
    paths.logsRoot,
    paths.cacheRoot,
    paths.pluginsRoot,
    paths.skillsRoot,
    paths.devicesRoot
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  if (!existsSync(paths.configFile)) {
    writeFileSync(paths.configFile, defaultConfigYaml(), { encoding: "utf8", flag: "wx" });
  }
}

export function defaultConfigYaml(): string {
  return [
    "version: 0.1",
    "control:",
    `  bind: ${DEFAULT_CONTROL_BIND}`,
    `  port: ${DEFAULT_CONTROL_PORT}`,
    "providers: {}",
    "models:",
    "  aliases: {}",
    "  fallbacks: {}",
    "mcp:",
    "  servers: {}",
    "context:",
    "  recentMessages: 6",
    "memory:",
    "  enabled: true",
    "  # root: /path/to/shared/Memory",
    "  autoWrite: explicit",
    "  maxResults: 8",
    "  scopes:",
    "    - user",
    "    - project",
    "    - session",
    "webSearch:",
    "  locale: zh-CN",
    "  market: CN",
    "  mainlandBoost: true",
    "  queryParam: q",
    "  resultsPath: results",
    "  titlePath: title",
    "  urlPath: url",
    "  snippetPath: snippet",
    "  maxResults: 10",
    ""
  ].join("\n");
}

function parseControlPort(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_CONTROL_PORT;
  }

  if (!/^[0-9]+$/.test(raw)) {
    throw new MagiConfigError(`MAGI_CONTROL_PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw)}`);
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MagiConfigError(`MAGI_CONTROL_PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw)}`);
  }

  return port;
}

type PathApi = Pick<typeof path, "join" | "normalize" | "resolve">;

function selectPathApi(env: NodeJS.ProcessEnv, ...values: Array<string | undefined>): PathApi {
  if (env.OS === "Windows_NT" || values.some((value) => value !== undefined && isWindowsPath(value))) {
    return path.win32;
  }
  return path;
}

function resolveHomeDir(env: NodeJS.ProcessEnv, homeDir: string, pathApi: PathApi): string {
  const candidates = [homeDir, env.USERPROFILE, env.HOME]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));

  if (pathApi === path.win32) {
    return candidates.find(isWindowsPath) ?? candidates[0] ?? ".";
  }
  return candidates[0] ?? ".";
}

function repairMissingRootSeparator(rawRoot: string, homeCandidates: Array<string | undefined>, pathApi: PathApi): string {
  const normalizedRoot = stripTrailingSeparators(pathApi.normalize(rawRoot.trim()));
  const rootNames = [DEVELOPMENT_ROOT_NAME, FUTURE_STABLE_ROOT_NAME];
  for (const candidate of homeCandidates) {
    const rawHome = candidate?.trim();
    if (!rawHome) continue;
    const normalizedHome = stripTrailingSeparators(pathApi.normalize(rawHome));
    for (const rootName of rootNames) {
      if (samePath(normalizedRoot, `${normalizedHome}${rootName}`, pathApi)) {
        return pathApi.join(normalizedHome, rootName);
      }
    }
  }
  return rawRoot;
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function samePath(left: string, right: string, pathApi: PathApi): boolean {
  const normalizedLeft = pathApi.normalize(left);
  const normalizedRight = pathApi.normalize(right);
  if (pathApi === path.win32) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
