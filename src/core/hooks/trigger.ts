import { HookEvent, HookDefinition } from "../config.ts";
import { executeHooks, HookContext } from "./runner.ts";

export interface TriggerHookInput {
  event: HookEvent;
  hooks: HookDefinition[];
  context: Partial<HookContext>;
  env?: NodeJS.ProcessEnv;
}

export async function triggerHook(input: TriggerHookInput): Promise<void> {
  if (!input.hooks || input.hooks.length === 0) {
    return;
  }
  
  const context: HookContext = {
    sessionId: input.context.sessionId ?? "",
    cwd: input.context.cwd ?? process.cwd(),
    ...input.context
  };
  
  await executeHooks({
    event: input.event,
    hooks: input.hooks,
    context,
    env: input.env
  });
}
