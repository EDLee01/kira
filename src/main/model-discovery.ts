export interface DiscoveredModel {
  id: string;
  label: string;
  source: "discovered" | "fallback";
  capabilities: ModelCapabilities;
}

export interface ModelCapabilities {
  role: "fast" | "main" | "deep";
  vision: boolean;
  longContext: boolean;
}

export interface AutoModelRoutes {
  fast: string;
  main: string;
  deep: string;
  vision: string;
  long: string;
}

export type DesktopProviderKind = "anthropic" | "openai" | "openai-compatible";
export type OpenAiDesktopEndpoint = "chat" | "responses";

export interface ModelDiscoveryResult {
  ok: boolean;
  message: string;
  models: DiscoveredModel[];
  auto: AutoModelRoutes;
  updatedAt: string;
}

export interface ModelSettings {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  openAiEndpoint?: string;
  discoveredModels?: string;
  autoRoutes?: string;
  modelsUpdatedAt?: string;
}

const FALLBACK_MODEL_IDS: Record<DesktopProviderKind, string[]> = {
  anthropic: [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  ],
  openai: [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o",
  ],
  "openai-compatible": [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o",
  "deepseek-chat",
  "deepseek-reasoner",
  ],
};

export function providerDefaults(provider: DesktopProviderKind): {
  baseUrl: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  defaultModel: string;
} {
  switch (provider) {
    case "openai":
      return {
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrlEnv: "OPENAI_BASE_URL",
        modelEnv: "OPENAI_MODEL",
        defaultModel: "gpt-4.1-mini",
      };
    case "openai-compatible":
      return {
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrlEnv: "OPENAI_BASE_URL",
        modelEnv: "OPENAI_MODEL",
        defaultModel: "gpt-4.1-mini",
      };
    case "anthropic":
    default:
      return {
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_AUTH_TOKEN",
        baseUrlEnv: "ANTHROPIC_BASE_URL",
        modelEnv: "ANTHROPIC_MODEL",
        defaultModel: "claude-haiku-4-5",
      };
  }
}

export function defaultModelDiscovery(): ModelDiscoveryResult {
  return defaultModelDiscoveryForProvider("anthropic");
}

export function defaultModelDiscoveryForProvider(provider: DesktopProviderKind): ModelDiscoveryResult {
  return buildModelDiscoveryResult({
    ok: true,
    message: "Using default model list",
    ids: FALLBACK_MODEL_IDS[provider],
    source: "fallback",
  });
}

export function modelDiscoveryFromSettings(settings: ModelSettings): ModelDiscoveryResult {
  const provider = readProvider(settings.provider);
  const fallback = defaultModelDiscoveryForProvider(provider);
  const parsedModels = parseJsonArray(settings.discoveredModels);
  const models = parsedModels.length > 0
    ? normalizeModelIds(parsedModels).map((id) => toDiscoveredModel(id, "discovered"))
    : fallback.models;

  return {
    ok: true,
    message: parsedModels.length > 0 ? "Loaded saved model list" : fallback.message,
    models,
    auto: buildAutoRoutes(models),
    updatedAt: settings.modelsUpdatedAt || fallback.updatedAt,
  };
}

export function resolveModelForDesktop(settings: ModelSettings): string {
  const provider = readProvider(settings.provider);
  const defaults = providerDefaults(provider);
  const selected = settings.model || process.env[defaults.modelEnv] || defaults.defaultModel;
  if (selected !== "auto") return selected;
  return modelDiscoveryFromSettings(settings).auto.main;
}

export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}

export function normalizeProviderBaseUrl(provider: DesktopProviderKind, baseUrl: string): string {
  if (provider === "anthropic") return normalizeAnthropicBaseUrl(baseUrl);
  return normalizeOpenAiBaseUrl(baseUrl);
}

export function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

export async function discoverModels(settings: ModelSettings, fetchImpl: typeof fetch = fetch): Promise<ModelDiscoveryResult> {
  const provider = readProvider(settings.provider);
  const defaults = providerDefaults(provider);
  const baseUrl = normalizeProviderBaseUrl(provider, settings.baseUrl || defaults.baseUrl);
  const apiKey = settings.apiKey || "";
  if (!apiKey.trim()) {
    return {
      ...defaultModelDiscoveryForProvider(provider),
      ok: false,
      message: "API Key is required to discover models",
    };
  }

  const attempts = buildModelListUrls(baseUrl);
  let lastError = "";
  for (const url of attempts) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: modelListHeaders(provider, apiKey),
      });
      const body = await res.text();
      if (!res.ok) {
        lastError = `${res.status}: ${body.slice(0, 160)}`;
        continue;
      }
      const ids = extractModelIds(body);
      if (ids.length === 0) {
        lastError = "model list response did not contain model ids";
        continue;
      }
      return buildModelDiscoveryResult({
        ok: true,
        message: `Found ${ids.length} models`,
        ids,
        source: "discovered",
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const fallback = defaultModelDiscoveryForProvider(provider);
  return {
    ...fallback,
    ok: false,
    message: `Could not fetch model list; using defaults. ${lastError}`,
  };
}

export async function testModelConnection(settings: ModelSettings, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; message: string; discovery: ModelDiscoveryResult }> {
  const provider = readProvider(settings.provider);
  const defaults = providerDefaults(provider);
  const discoveryResult = await discoverModels(settings, fetchImpl);
  const discovery = discoveryResult.ok
    ? discoveryResult
    : {
        ...modelDiscoveryFromSettings(settings),
        ok: false,
        message: discoveryResult.message,
      };
  const model = settings.model === "auto" ? discovery.auto.main : (settings.model || discovery.auto.main);
  const baseUrl = normalizeProviderBaseUrl(provider, settings.baseUrl || defaults.baseUrl);
  const apiKey = settings.apiKey || "";

  try {
    const res = provider === "anthropic"
      ? await testAnthropicConnection(fetchImpl, baseUrl, apiKey, model)
      : await testOpenAiConnection(fetchImpl, baseUrl, apiKey, model, settings.openAiEndpoint);
    if (res.ok) {
      return {
        ok: true,
        message: `Connected with ${model}. ${discovery.message}`,
        discovery,
      };
    }
    const body = await res.text();
    return {
      ok: false,
      message: `${res.status}: ${body.slice(0, 140)}`,
      discovery,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      discovery,
    };
  }
}

export function serializeModelDiscovery(discovery: ModelDiscoveryResult): Pick<ModelSettings, "discoveredModels" | "autoRoutes" | "modelsUpdatedAt"> {
  return {
    discoveredModels: JSON.stringify(discovery.models.filter((m) => m.source === "discovered").map((m) => m.id)),
    autoRoutes: JSON.stringify(discovery.auto),
    modelsUpdatedAt: discovery.updatedAt,
  };
}

function buildModelDiscoveryResult(input: {
  ok: boolean;
  message: string;
  ids: string[];
  source: "discovered" | "fallback";
}): ModelDiscoveryResult {
  const models = normalizeModelIds(input.ids).map((id) => toDiscoveredModel(id, input.source));
  return {
    ok: input.ok,
    message: input.message,
    models,
    auto: buildAutoRoutes(models),
    updatedAt: new Date().toISOString(),
  };
}

function buildAutoRoutes(models: DiscoveredModel[]): AutoModelRoutes {
  const bestByRole = (role: ModelCapabilities["role"]) => bestModel(models.filter((m) => m.capabilities.role === role))?.id;
  const bestAny = bestModel(models)?.id ?? "claude-haiku-4-5";
  const fast = bestByRole("fast") ?? bestAny;
  const main = bestByRole("main") ?? bestAny;
  const deep = bestByRole("deep") ?? main;
  const vision = bestModel(models.filter((model) => model.capabilities.vision))?.id ?? main;
  const long = bestModel(models.filter((model) => model.capabilities.longContext))?.id ?? main;
  return { fast, main, deep, vision, long };
}

function bestModel(models: DiscoveredModel[]): DiscoveredModel | undefined {
  return [...models].sort((a, b) => modelQualityScore(b.id) - modelQualityScore(a.id) || a.id.localeCompare(b.id))[0];
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toDiscoveredModel(id: string, source: "discovered" | "fallback"): DiscoveredModel {
  return {
    id,
    label: labelForModel(id),
    source,
    capabilities: inferCapabilities(id),
  };
}

function inferCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  const role: ModelCapabilities["role"] =
    id.includes("opus") || id.includes("o3") || id.includes("o4") || id.includes("o1") || id.includes("reasoner") || id.includes("reasoning") || (id.startsWith("gpt-") && id.includes("pro"))
      ? "deep"
      : id.includes("haiku") || id.includes("mini") || id.includes("flash") || id.includes("lite") || id.includes("small")
        ? "fast"
        : "main";

  const vision =
    id.includes("claude-3") ||
    id.includes("claude-4") ||
    id.includes("sonnet") ||
    id.includes("opus") ||
    id.includes("gpt-4o") ||
    id.includes("gpt-4.1") ||
    id.includes("gpt-5") ||
    id.includes("vision") ||
    id.includes("gemini");

  const longContext =
    id.includes("200k") ||
    id.includes("1m") ||
    id.includes("long") ||
    id.includes("claude") ||
    id.includes("gemini") ||
    id.includes("gpt-4.1") ||
    id.includes("gpt-5");

  return { role, vision, longContext };
}

function extractModelIds(body: string): string[] {
  const parsed = JSON.parse(body);
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.models)
        ? parsed.models
        : [];

  return records
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return typeof record.id === "string"
        ? record.id
        : typeof record.name === "string"
          ? record.name
          : "";
    })
    .filter(Boolean);
}

function normalizeModelIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.sort(compareModels);
}

function compareModels(a: string, b: string): number {
  return modelQualityScore(b) - modelQualityScore(a) || a.localeCompare(b);
}

function modelQualityScore(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes("auto")) return 0;

  let score = 100;
  const gpt = lower.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (gpt) {
    score = 1000 + Number(gpt[1]) * 100 + Number(gpt[2] ?? 0) * 10;
  } else if (lower.includes("o4")) {
    score = 1480;
  } else if (lower.includes("o3")) {
    score = 1430;
  } else if (lower.includes("o1")) {
    score = 1410;
  } else if (lower.includes("claude-opus-4-7")) {
    score = 1670;
  } else if (lower.includes("claude-opus-4")) {
    score = 1640;
  } else if (lower.includes("claude-sonnet-4-6")) {
    score = 1560;
  } else if (lower.includes("claude-sonnet-4")) {
    score = 1540;
  } else if (lower.includes("claude-haiku-4-5")) {
    score = 1450;
  } else if (lower.includes("gemini-2.5")) {
    score = 1250;
  } else if (lower.includes("gemini-2")) {
    score = 1200;
  } else if (lower.includes("deepseek-reasoner")) {
    score = 1320;
  } else if (lower.includes("deepseek")) {
    score = 1180;
  }

  if (lower.includes("pro")) score += 8;
  if (lower.includes("codex")) score += 5;
  if (lower.includes("chat")) score -= 4;
  if (lower.includes("nano")) score -= 35;
  if (lower.includes("mini")) score -= 25;
  if (lower.includes("flash") || lower.includes("haiku") || lower.includes("lite") || lower.includes("small")) score -= 20;
  if (lower.includes("preview")) score -= 5;
  return score;
}

function labelForModel(id: string): string {
  return id
    .replace(/^claude-/, "Claude ")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^gpt-/, "GPT-")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildModelListUrls(baseUrl: string): string[] {
  if (baseUrl.endsWith("/v1")) return [`${baseUrl}/models`];
  return [`${baseUrl}/v1/models`, `${baseUrl}/models`];
}

function readProvider(value: string | undefined): DesktopProviderKind {
  return value === "openai" || value === "openai-compatible" ? value : "anthropic";
}

function modelListHeaders(provider: DesktopProviderKind, apiKey: string): Record<string, string> {
  if (provider === "anthropic") {
    return {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "Authorization": `Bearer ${apiKey}`,
  };
}

async function testAnthropicConnection(fetchImpl: typeof fetch, baseUrl: string, apiKey: string, model: string): Promise<Response> {
  return fetchImpl(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

async function testOpenAiConnection(fetchImpl: typeof fetch, baseUrl: string, apiKey: string, model: string, endpoint?: string): Promise<Response> {
  if (endpoint === "responses") {
    return fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: "hi",
        max_output_tokens: 10,
      }),
    });
  }
  return fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 10,
    }),
  });
}
