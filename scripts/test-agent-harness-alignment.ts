import assert from "node:assert/strict";

import { collectAgentQuery } from "../src/core/agent/query.ts";
import { OpenAiAdapter } from "../src/core/providers/openai.ts";
import { MessagesCompatibleAdapter } from "../src/core/providers/messages-compatible.ts";
import { ProviderError } from "../src/core/providers/errors.ts";
import { ProviderAdapter, ProviderRequest, ProviderResponse, textMessage } from "../src/core/providers/ir.ts";
import { modelDiscoveryFromSettings, resolveModelForDesktop } from "../src/main/model-discovery.ts";
import { executeRegisteredTool } from "../src/core/tools/registry.ts";

class SequenceAdapter implements ProviderAdapter {
  readonly name = "sequence";
  calls = 0;

  async complete(_request: ProviderRequest): Promise<ProviderResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      return { text: "自己的作业自己做。" };
    }
    return { text: "已改为执行任务，而不是泛化拒绝。" };
  }
}

async function main(): Promise<void> {
  const discoveredModels = [
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.4-mini",
    "gpt-5.2-pro",
    "gpt-5.5",
    "o3-pro"
  ];
  const staleAutoRoutes = {
    fast: "gpt-4.1-mini",
    main: "gpt-4.1",
    deep: "o1-mini",
    vision: "gpt-4.1",
    long: "gpt-4.1"
  };
  const settings = {
    provider: "openai-compatible",
    model: "auto",
    discoveredModels: JSON.stringify(discoveredModels),
    autoRoutes: JSON.stringify(staleAutoRoutes)
  };
  const discovery = modelDiscoveryFromSettings(settings);
  assert.equal(discovery.auto.main, "gpt-5.5");
  assert.equal(discovery.auto.fast, "gpt-5.4-mini");
  assert.equal(resolveModelForDesktop(settings), "gpt-5.5");

  const refusalAdapter = new OpenAiAdapter({
    name: "openai-compatible",
    config: {
      type: "openai",
      baseUrl: "https://example.invalid/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "gpt-test"
    },
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: "content_filter",
        message: { role: "assistant", content: "" }
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(
    refusalAdapter.complete({ model: "gpt-test", messages: [textMessage("user", "hi")] }),
    (error) => error instanceof ProviderError && error.kind === "refusal" && /content_filter/.test(error.message)
  );

  const bareToolArgumentsAdapter = new OpenAiAdapter({
    name: "deepseek-compatible",
    config: {
      type: "openai",
      baseUrl: "https://example.invalid/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "deepseek-chat"
    },
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_bash",
            type: "function",
            function: {
              name: "Bash",
              arguments: "printf deepseek-bare-ok"
            }
          }]
        }
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const bareToolResponse = await bareToolArgumentsAdapter.complete({
    model: "deepseek-chat",
    messages: [textMessage("user", "run a harmless command")]
  });
  assert.equal(bareToolResponse.toolUses.length, 1);
  const bareToolResult = await executeRegisteredTool({
    cwd: process.cwd(),
    toolUse: bareToolResponse.toolUses[0],
    permissionMode: "auto"
  });
  assert.equal(bareToolResult.isError, undefined);
  assert.match(bareToolResult.content, /deepseek-bare-ok/);

  const anthropicDeepSeekAdapter = new MessagesCompatibleAdapter({
    name: "deepseek-anthropic",
    config: {
      type: "openai-compatible",
      baseUrl: "https://example.invalid",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "deepseek-chat",
      format: "anthropic-messages"
    },
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async () => new Response(JSON.stringify({
      id: "msg_deepseek_tool",
      type: "message",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "toolu_bash",
        name: "Bash",
        input: "printf ds-anthropic-bare-ok"
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const anthropicToolResponse = await anthropicDeepSeekAdapter.complete({
    model: "deepseek-chat",
    messages: [textMessage("user", "run a harmless command")]
  });
  assert.equal(anthropicToolResponse.toolUses.length, 1);
  const anthropicToolResult = await executeRegisteredTool({
    cwd: process.cwd(),
    toolUse: anthropicToolResponse.toolUses[0],
    permissionMode: "auto"
  });
  assert.equal(anthropicToolResult.isError, undefined);
  assert.match(anthropicToolResult.content, /ds-anthropic-bare-ok/);

  for (const [input, expected] of [
    [{ cmd: "printf deepseek-cmd-ok" }, /deepseek-cmd-ok/],
    [{ command: { cmd: "printf deepseek-wrapped-ok" } }, /deepseek-wrapped-ok/],
    [{ command: ["printf", "deepseek array ok"] }, /deepseek array ok/]
  ] as const) {
    const result = await executeRegisteredTool({
      cwd: process.cwd(),
      toolUse: {
        type: "tool-use",
        id: `call_${String(expected)}`,
        name: "Bash",
        input
      },
      permissionMode: "auto"
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content, expected);
  }

  const naturalRefusalAdapter = new SequenceAdapter();
  const result = await collectAgentQuery({
    adapter: naturalRefusalAdapter,
    model: "sequence",
    providerName: "sequence",
    messages: [textMessage("user", "帮我做一个课程汇报 PPT")],
    cwd: process.cwd(),
    maxTurns: 3
  });
  assert.equal(naturalRefusalAdapter.calls, 2);
  assert.match(result.text, /已改为执行任务/);
  assert.doesNotMatch(result.text, /自己的作业自己做/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
