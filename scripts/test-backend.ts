/**
 * Backend smoke test — runs the agent loop directly (no Electron).
 * Verifies: provider build, session store, message parsing, stream events.
 *
 * Usage: npx tsx scripts/test-backend.ts
 */
import { MessagesCompatibleAdapter } from "../src/core/providers/messages-compatible.ts";
import { runAgentQuery } from "../src/core/agent/query.ts";
import { getMagiPaths } from "../src/core/paths.ts";

async function main() {
  console.log("=== kira backend smoke test ===\n");

  // 1. Build provider from env
  const apiKey = process.env["ANTHROPIC_AUTH_TOKEN"];
  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
  const rawModel = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5";
  const model = rawModel === "auto"
    ? (process.env["ANTHROPIC_DEFAULT_SONNET_MODEL"] ?? "claude-sonnet-4-6")
    : rawModel;

  if (!apiKey) {
    console.error("FAIL: ANTHROPIC_AUTH_TOKEN not set");
    process.exit(1);
  }

  console.log(`  provider: messages-compatible (anthropic-messages)`);
  console.log(`  baseUrl:  ${baseUrl}`);
  console.log(`  model:    ${model}\n`);

  const adapter = new MessagesCompatibleAdapter({
    name: "anthropic",
    config: {
      type: "messages-compatible",
      format: "anthropic-messages",
      baseUrl,
      apiKeyEnv: "ANTHROPIC_AUTH_TOKEN",
      defaultModel: model,
    },
    env: process.env,
  });

  // 2. Build test messages
  const messages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: "你好！用一句话介绍你自己。" }],
    },
  ];

  // 3. Run agent loop
  console.log("  sending query...\n");

  const events: string[] = [];
  try {
    for await (const event of runAgentQuery({
      adapter,
      model,
      providerName: "anthropic",
      messages,
      cwd: process.cwd(),
      env: process.env,
      permissionMode: "auto",
    })) {
      events.push(event.type);
      switch (event.type) {
        case "request_start":
          console.log("  [request_start]");
          break;
        case "text_delta":
          process.stdout.write(event.text ?? "");
          break;
        case "usage":
          console.log(`\n  [usage] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`);
          break;
        case "done":
          console.log(`\n  [done] turns=${event.turns}\n`);
          break;
        case "error":
          console.log(`\n  FAIL: ${event.error}`);
          process.exit(1);
        default:
          if (event.type !== "request_start") {
            console.log(`  [${event.type}]`);
          }
      }
    }
  } catch (err) {
    console.error(`\n  FAIL: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log("=== PASSED ===");
}

main();