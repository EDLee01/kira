import { MagiPaths } from "../core/paths.ts";
import { ProviderAdapter } from "../core/providers/ir.ts";
import { MessagesCompatibleAdapter } from "../core/providers/messages-compatible.ts";
import { OpenAiAdapter } from "../core/providers/openai.ts";
import { readDesktopSettings } from "./settings-store";
import {
  DesktopProviderKind,
  normalizeProviderBaseUrl,
  providerDefaults,
  resolveModelForDesktop,
} from "./model-discovery";

export interface DesktopProviderRuntime {
  adapter: ProviderAdapter;
  providerName: string;
  model: string;
  env: NodeJS.ProcessEnv;
}

export function buildDesktopProvider(paths: MagiPaths, env: NodeJS.ProcessEnv = process.env): DesktopProviderRuntime {
  const settings = readDesktopSettings(paths);
  const provider = readProvider(settings.provider);
  const defaults = providerDefaults(provider);
  const apiKey = settings.apiKey || env[defaults.apiKeyEnv] || "";
  const baseUrl = normalizeProviderBaseUrl(provider, settings.baseUrl || env[defaults.baseUrlEnv] || defaults.baseUrl);
  const model = resolveModelForDesktop(settings);
  const runtimeEnv = {
    ...env,
    [defaults.apiKeyEnv]: apiKey,
    [defaults.baseUrlEnv]: baseUrl,
    [defaults.modelEnv]: model,
  };

  if (provider === "anthropic") {
    return {
      adapter: new MessagesCompatibleAdapter({
        name: "anthropic",
        config: {
          type: "messages-compatible",
          format: "anthropic-messages",
          baseUrl,
          apiKeyEnv: defaults.apiKeyEnv,
          defaultModel: model,
        },
        env: runtimeEnv,
      }),
      providerName: "anthropic",
      model,
      env: runtimeEnv,
    };
  }

  return {
    adapter: new OpenAiAdapter({
      name: provider === "openai" ? "openai" : "openai-compatible",
      config: {
        type: "openai",
        baseUrl,
        apiKeyEnv: defaults.apiKeyEnv,
        defaultModel: model,
        endpoint: settings.openAiEndpoint === "responses" ? "responses" : "chat",
      },
      env: runtimeEnv,
    }),
    providerName: provider === "openai" ? "openai" : "openai-compatible",
    model,
    env: runtimeEnv,
  };
}

function readProvider(value: string | undefined): DesktopProviderKind {
  return value === "openai" || value === "openai-compatible" ? value : "anthropic";
}
