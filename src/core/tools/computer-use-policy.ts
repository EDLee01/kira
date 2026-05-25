export type ComputerUseAppCategory = "browser" | "terminal" | "trading" | "policy_denied";
export type ComputerUseActionKind = "mouse_position" | "mouse" | "mouse_full" | "keyboard" | "open_app";

export interface ComputerUseAppInfo {
  bundleId?: string;
  displayName?: string;
}

export interface ComputerUsePolicyDecision {
  allowed: boolean;
  category: ComputerUseAppCategory | null;
  tier: ComputerUseAppTier;
  warning?: string;
  reason?: string;
}

export type ComputerUseAppTier = "read" | "click" | "full";

const TIER_ANTI_SUBVERSION = " Do not try to bypass this restriction through shortcuts, shell commands, scripts, automation APIs, or another tool.";

const BROWSER_BUNDLE_IDS = new Set([
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.dev",
  "com.google.Chrome.canary",
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.Beta",
  "com.microsoft.edgemac.Dev",
  "com.microsoft.edgemac.Canary",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "org.mozilla.nightly",
  "org.chromium.Chromium",
  "com.brave.Browser",
  "com.brave.Browser.beta",
  "com.brave.Browser.nightly",
  "com.operasoftware.Opera",
  "com.operasoftware.OperaGX",
  "com.operasoftware.OperaDeveloper",
  "com.vivaldi.Vivaldi",
  "company.thebrowser.Browser",
  "company.thebrowser.dia",
  "org.torproject.torbrowser",
  "com.duckduckgo.macos.browser",
  "ru.yandex.desktop.yandex-browser",
  "ai.perplexity.comet",
  "com.sigmaos.sigmaos.macos",
  "com.kagi.kagimacOS"
]);

const TERMINAL_BUNDLE_IDS = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "dev.warp.Warp-Beta",
  "com.github.wez.wezterm",
  "org.alacritty",
  "io.alacritty",
  "net.kovidgoyal.kitty",
  "co.zeit.hyper",
  "com.mitchellh.ghostty",
  "org.tabby",
  "com.termius-dmg.mac",
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.vscodium",
  "com.todesktop.230313mzl4w4u92",
  "com.exafunction.windsurf",
  "dev.zed.Zed",
  "dev.zed.Zed-Preview",
  "com.jetbrains.intellij",
  "com.jetbrains.intellij.ce",
  "com.jetbrains.pycharm",
  "com.jetbrains.pycharm.ce",
  "com.jetbrains.WebStorm",
  "com.jetbrains.CLion",
  "com.jetbrains.goland",
  "com.jetbrains.rubymine",
  "com.jetbrains.PhpStorm",
  "com.jetbrains.datagrip",
  "com.jetbrains.rider",
  "com.jetbrains.AppCode",
  "com.jetbrains.rustrover",
  "com.jetbrains.fleet",
  "com.google.android.studio",
  "com.axosoft.gitkraken",
  "com.sublimetext.4",
  "com.sublimetext.3",
  "org.vim.MacVim",
  "com.neovim.neovim",
  "org.gnu.Emacs",
  "com.apple.dt.Xcode",
  "org.eclipse.platform.ide",
  "org.netbeans.ide",
  "com.microsoft.visual-studio",
  "com.apple.ScriptEditor2",
  "com.apple.Automator",
  "com.apple.shortcuts"
]);

const TRADING_BUNDLE_IDS = new Set([
  "com.webull.desktop.v1",
  "com.webull.trade.mac.v1",
  "com.tastytrade.desktop",
  "com.tradingview.tradingviewapp.desktop",
  "com.fidelity.activetrader",
  "com.fmr.activetrader",
  "com.install4j.5889-6375-8446-2021",
  "com.binance.BinanceDesktop",
  "com.electron.exodus",
  "org.pythonmac.unspecified.Electrum",
  "com.ledger.live",
  "io.trezor.TrezorSuite"
]);

const POLICY_DENIED_BUNDLE_IDS = new Set([
  "com.apple.TV",
  "com.apple.Music",
  "com.apple.iBooksX",
  "com.apple.podcasts",
  "com.spotify.client",
  "com.amazon.music",
  "com.tidal.desktop",
  "com.deezer.deezer-desktop",
  "com.pandora.desktop",
  "com.electron.pocket-casts",
  "au.com.shiftyjelly.PocketCasts",
  "tv.plex.desktop",
  "tv.plex.htpc",
  "tv.plex.plexamp",
  "com.amazon.aiv.AIVApp",
  "net.kovidgoyal.calibre",
  "com.amazon.Kindle",
  "com.amazon.Lassen",
  "com.kobo.desktop.Kobo"
]);

const POLICY_DENIED_NAME_SUBSTRINGS = [
  "netflix",
  "disney+",
  "hulu",
  "prime video",
  "apple tv",
  "peacock",
  "paramount+",
  "tubi",
  "crunchyroll",
  "vudu",
  "kindle",
  "apple books",
  "kobo",
  "play books",
  "calibre",
  "libby",
  "readium",
  "audible",
  "libro.fm",
  "speechify",
  "spotify",
  "apple music",
  "amazon music",
  "youtube music",
  "tidal",
  "deezer",
  "pandora",
  "pocket casts",
  "naver",
  "reddit",
  "sony music",
  "vegas pro",
  "pitchfork",
  "economist",
  "nytimes"
];

const BROWSER_NAME_SUBSTRINGS = [
  "safari",
  "chrome",
  "firefox",
  "microsoft edge",
  "brave",
  "opera",
  "vivaldi",
  "chromium",
  "arc browser",
  "tor browser",
  "duckduckgo",
  "yandex",
  "orion browser",
  "comet",
  "sigmaos",
  "dia browser"
];

const TERMINAL_NAME_SUBSTRINGS = [
  "terminal",
  "iterm",
  "wezterm",
  "alacritty",
  "kitty",
  "ghostty",
  "tabby",
  "termius",
  "script editor",
  "automator",
  "powershell",
  "cmd.exe",
  "command prompt",
  "git bash",
  "conemu",
  "cmder",
  "visual studio code",
  "visual studio",
  "vscode",
  "vs code",
  "vscodium",
  "cursor",
  "windsurf",
  "intellij",
  "pycharm",
  "webstorm",
  "clion",
  "goland",
  "rubymine",
  "phpstorm",
  "datagrip",
  "rider",
  "appcode",
  "rustrover",
  "fleet",
  "android studio",
  "sublime text",
  "macvim",
  "neovim",
  "emacs",
  "xcode",
  "eclipse",
  "netbeans"
];

const TRADING_NAME_SUBSTRINGS = [
  "bloomberg",
  "ameritrade",
  "thinkorswim",
  "schwab",
  "fidelity",
  "e*trade",
  "interactive brokers",
  "trader workstation",
  "tradestation",
  "webull",
  "robinhood",
  "tastytrade",
  "ninjatrader",
  "tradingview",
  "moomoo",
  "tradezero",
  "prorealtime",
  "plus500",
  "saxotrader",
  "oanda",
  "metatrader",
  "forex.com",
  "avaoptions",
  "ctrader",
  "jforex",
  "iq option",
  "olymp trade",
  "binomo",
  "pocket option",
  "raceoption",
  "expertoption",
  "quotex",
  "naga",
  "morgan stanley",
  "ubs neo",
  "eikon",
  "coinbase",
  "kraken",
  "binance",
  "okx",
  "bybit",
  "phemex",
  "stormgain",
  "crypto.com",
  "electrum",
  "ledger live",
  "trezor",
  "guarda",
  "atomic wallet",
  "bitpay",
  "bisq",
  "koinly",
  "cointracker",
  "blockfi",
  "stripe cli",
  "decentraland",
  "axie infinity",
  "gods unchained"
];

export function getComputerUseAppCategory(app: ComputerUseAppInfo | undefined): ComputerUseAppCategory | null {
  if (!app) return null;
  const bundleId = normalize(app.bundleId);
  const displayName = normalize(app.displayName);
  if (bundleId && POLICY_DENIED_BUNDLE_IDS.has(bundleId)) return "policy_denied";
  if (bundleId && TRADING_BUNDLE_IDS.has(bundleId)) return "trading";
  if (bundleId && BROWSER_BUNDLE_IDS.has(bundleId)) return "browser";
  if (bundleId && TERMINAL_BUNDLE_IDS.has(bundleId)) return "terminal";

  if (containsAny(displayName, POLICY_DENIED_NAME_SUBSTRINGS)) return "policy_denied";
  if (containsAny(displayName, TRADING_NAME_SUBSTRINGS)) return "trading";
  if (containsAny(displayName, BROWSER_NAME_SUBSTRINGS)) return "browser";
  if (containsAny(displayName, TERMINAL_NAME_SUBSTRINGS)) return "terminal";
  return null;
}

export function getDefaultComputerUseTier(app: ComputerUseAppInfo | undefined): ComputerUseAppTier {
  const category = getComputerUseAppCategory(app);
  if (category === "browser") return "read";
  if (category === "terminal") return "click";
  if (category === "trading") return "read";
  return "full";
}

export function buildComputerUseTierGuidance(
  apps: Array<ComputerUseAppInfo & { tier?: ComputerUseAppTier }>
): string | undefined {
  const tiered = apps.map((app) => ({ ...app, tier: app.tier ?? getDefaultComputerUseTier(app) }));
  const restricted = tiered.filter((app) => app.tier !== "full");
  if (restricted.length === 0) return undefined;

  const readBrowsers = restricted.filter((app) =>
    app.tier === "read" && getComputerUseAppCategory(app) === "browser"
  );
  const readOther = restricted.filter((app) =>
    app.tier === "read" && getComputerUseAppCategory(app) !== "browser"
  );
  const clickTier = restricted.filter((app) => app.tier === "click");
  const parts: string[] = [];

  if (readBrowsers.length > 0) {
    const names = appNames(readBrowsers);
    parts.push(`${names} ${readBrowsers.length === 1 ? "is a browser" : "are browsers"} granted at tier "read": visible in screenshots only; no clicks, typing, navigation, or shortcuts.`);
  }
  if (readOther.length > 0) {
    const names = appNames(readOther);
    parts.push(`${names} ${readOther.length === 1 ? "is" : "are"} granted at tier "read": Kira may observe only. Ask the user to perform any action in ${readOther.length === 1 ? "that app" : "those apps"}.`);
  }
  if (clickTier.length > 0) {
    const names = appNames(clickTier);
    parts.push(`${names} ${clickTier.length === 1 ? "has" : "have"} terminal, IDE, or script-runner capabilities and ${clickTier.length === 1 ? "is" : "are"} granted at tier "click": visible plus move, scroll, and plain left-click only; no typing, key presses, right-click, modifier-click, or drag-drop. Use Bash for command-line work.`);
  }

  return parts.length > 0 ? `${parts.join("\n\n")}${TIER_ANTI_SUBVERSION}` : undefined;
}

export function buildComputerUsePolicyDeniedGuidance(
  denied: Array<{ requestedName: string; displayName: string }>
): string | undefined {
  if (denied.length === 0) return undefined;
  const names = denied.map((app) => `"${app.displayName}"`).join(", ");
  const one = denied.length === 1;
  return `${names} ${one ? "is" : "are"} blocked by Computer Use policy. Requests for ${one ? "this app" : "these apps"} are automatically denied; there is no settings override. Tell the user Kira cannot access ${one ? "this app" : "these apps"} and use a non-computer-control alternative if one exists. Do not try to subvert this block.`;
}

export function evaluateComputerUseAppPolicy(
  app: ComputerUseAppInfo | undefined,
  actionKind: ComputerUseActionKind
): ComputerUsePolicyDecision {
  const category = getComputerUseAppCategory(app);
  const tier = getDefaultComputerUseTier(app);
  if (!category) return { allowed: true, category: null, tier };

  const appName = formatComputerUseApp(app);
  if (category === "policy_denied") {
    return {
      allowed: false,
      category,
      tier,
      reason: `${appName} is blocked by Computer Use policy. Do not observe or control copyrighted media, ebook, music, or publisher apps.`
    };
  }
  if (category === "trading" && actionKind !== "mouse_position" && actionKind !== "open_app") {
    return {
      allowed: false,
      category,
      tier,
      reason: `${appName} is treated as a trading or crypto app. Kira can look, but must not click, type, drag, scroll, or send shortcuts there.`
    };
  }
  if (category === "terminal" && (actionKind === "keyboard" || actionKind === "mouse_full")) {
    return {
      allowed: false,
      category,
      tier,
      reason: `${appName} is a terminal, IDE, or script runner. Kira may move, scroll, or plain-click, but cannot type, drag, right-click, or send shortcuts there. Use Bash for command-line work.`
    };
  }
  if (category === "browser") {
    if (actionKind !== "mouse_position" && actionKind !== "open_app") {
      return {
        allowed: false,
        category,
        tier,
        reason: `${appName} is a browser granted at tier "read": Kira can observe the visible browser page only, but cannot click, type, scroll, navigate, drag, or send shortcuts there through Computer Use. Ask the user to perform browser actions, or use an explicit non-ComputerUse browser/data source when appropriate.`
      };
    }
    return {
      allowed: true,
      category,
      tier,
      warning: `${appName} is a browser granted at tier "read": Kira may bring it forward and observe the visible page, but cannot interact with it through Computer Use.`
    };
  }
  return { allowed: true, category, tier };
}

export function formatComputerUseApp(app: ComputerUseAppInfo | undefined): string {
  if (!app) return "the target app";
  const display = app.displayName?.trim();
  const bundle = app.bundleId?.trim();
  if (display && bundle && display !== bundle) return `${display} (${bundle})`;
  return display || bundle || "the target app";
}

function appNames(apps: ComputerUseAppInfo[]): string {
  return apps.map((app) => `"${formatComputerUseApp(app)}"`).join(", ");
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

function containsAny(value: string, substrings: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return substrings.some((item) => lower.includes(item));
}
