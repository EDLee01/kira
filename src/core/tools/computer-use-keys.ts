const CANONICAL_MODIFIER: Record<string, string> = {
  meta: "meta",
  super: "meta",
  command: "meta",
  cmd: "meta",
  windows: "meta",
  win: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  lctrl: "ctrl",
  lcontrol: "ctrl",
  rctrl: "ctrl",
  rcontrol: "ctrl",
  shift: "shift",
  lshift: "shift",
  rshift: "shift",
  alt: "alt",
  option: "alt"
};

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"];

const BLOCKED_DARWIN = new Set([
  "meta+q",
  "shift+meta+q",
  "alt+meta+escape",
  "meta+tab",
  "meta+space",
  "ctrl+meta+q"
]);

const BLOCKED_WIN32 = new Set([
  "ctrl+alt+delete",
  "alt+f4",
  "alt+tab",
  "meta+l",
  "meta+d"
]);

export function normalizeComputerUseKeySequence(sequence: string): string {
  const { mods, keys } = partitionKeys(sequence);
  return [...mods, ...keys].join("+");
}

export function isSystemComputerUseKeyCombo(sequence: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "darwin" && platform !== "win32") return false;
  const blocklist = platform === "darwin" ? BLOCKED_DARWIN : BLOCKED_WIN32;
  const { mods, keys } = partitionKeys(sequence);
  const prefix = mods.length > 0 ? `${mods.join("+")}+` : "";
  if (keys.length === 0) {
    return blocklist.has(mods.join("+"));
  }
  return keys.some((key) => blocklist.has(prefix + key));
}

function partitionKeys(sequence: string): { mods: string[]; keys: string[] } {
  const parts = sequence
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const mods: string[] = [];
  const keys: string[] = [];
  for (const part of parts) {
    const canonical = CANONICAL_MODIFIER[part];
    if (canonical) {
      mods.push(canonical);
    } else {
      keys.push(part);
    }
  }
  const uniqueMods = [...new Set(mods)];
  uniqueMods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return { mods: uniqueMods, keys };
}
