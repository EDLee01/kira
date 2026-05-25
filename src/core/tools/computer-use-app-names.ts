interface InstalledAppLike {
  readonly bundleId: string;
  readonly displayName: string;
  readonly path?: string;
}

const PATH_ALLOWLIST = [
  "/Applications/",
  "/System/Applications/"
] as const;

const NAME_PATTERN_BLOCKLIST = [
  /Helper(?:$|\s\()/,
  /Agent(?:$|\s\()/,
  /Service(?:$|\s\()/,
  /Uninstaller(?:$|\s\()/,
  /Updater(?:$|\s\()/,
  /^\./
] as const;

const ALWAYS_KEEP_BUNDLE_IDS = new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "company.thebrowser.Browser",
  "com.tinyspeck.slackmacgap",
  "us.zoom.xos",
  "com.microsoft.teams2",
  "com.microsoft.teams",
  "com.apple.MobileSMS",
  "com.apple.mail",
  "com.microsoft.Word",
  "com.microsoft.Excel",
  "com.microsoft.Powerpoint",
  "com.microsoft.Outlook",
  "com.apple.iWork.Pages",
  "com.apple.iWork.Numbers",
  "com.apple.iWork.Keynote",
  "com.google.GoogleDocs",
  "notion.id",
  "com.apple.Notes",
  "md.obsidian",
  "com.linear",
  "com.figma.Desktop",
  "com.microsoft.VSCode",
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.github.GitHubDesktop",
  "com.apple.finder",
  "com.apple.iCal",
  "com.apple.systempreferences"
]);

const APP_NAME_ALLOWED = /^[\p{L}\p{M}\p{N}_ .&'()+-]+$/u;
const APP_NAME_MAX_LEN = 40;
const APP_NAME_MAX_COUNT = 50;

export function filterComputerUseAppsForDescription(
  installed: readonly InstalledAppLike[],
  homeDir: string | undefined
): string[] {
  const alwaysKept: string[] = [];
  const rest: string[] = [];
  for (const app of installed) {
    if (ALWAYS_KEEP_BUNDLE_IDS.has(app.bundleId)) {
      alwaysKept.push(app.displayName);
    } else if (isUserFacingPath(app.path ?? "", homeDir) && !isNoisyName(app.displayName)) {
      rest.push(app.displayName);
    }
  }

  const sanitizedAlways = sanitizeTrustedNames(alwaysKept);
  const alwaysSet = new Set(sanitizedAlways);
  return [
    ...sanitizedAlways,
    ...sanitizeAppNames(rest).filter((name) => !alwaysSet.has(name))
  ];
}

function isUserFacingPath(appPath: string, homeDir: string | undefined): boolean {
  if (PATH_ALLOWLIST.some((root) => appPath.startsWith(root))) return true;
  if (!homeDir) return false;
  const userApps = homeDir.endsWith("/") ? `${homeDir}Applications/` : `${homeDir}/Applications/`;
  return appPath.startsWith(userApps);
}

function isNoisyName(name: string): boolean {
  return NAME_PATTERN_BLOCKLIST.some((pattern) => pattern.test(name));
}

function sanitizeAppNames(raw: readonly string[]): string[] {
  const filtered = sanitizeCore(raw, true);
  if (filtered.length <= APP_NAME_MAX_COUNT) return filtered;
  return [
    ...filtered.slice(0, APP_NAME_MAX_COUNT),
    `... and ${filtered.length - APP_NAME_MAX_COUNT} more`
  ];
}

function sanitizeTrustedNames(raw: readonly string[]): string[] {
  return sanitizeCore(raw, false);
}

function sanitizeCore(raw: readonly string[], applyCharFilter: boolean): string[] {
  const seen = new Set<string>();
  return raw
    .map((name) => name.trim())
    .filter((name) => {
      if (!name) return false;
      if (name.length > APP_NAME_MAX_LEN) return false;
      if (applyCharFilter && !APP_NAME_ALLOWED.test(name)) return false;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}
