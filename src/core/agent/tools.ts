import { MagiMessage, MagiToolDefinition, MagiToolUsePart } from "../providers/ir.ts";
import { WebSearchConfig } from "../config.ts";
import {
  executeRegisteredTool,
  executeRegisteredTools,
  getBuiltinToolDefinitions,
  SubAgentRequest,
  SubAgentResult,
  ToolPermissionMode
} from "../tools/registry.ts";
import { UserQuestionResolver } from "../tools/user-question.ts";
import { UserMessageSink } from "../tools/user-message.ts";

export interface AgentToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
  retryable?: boolean;
  permission?: { decision: "allow" | "ask" | "deny"; reason: string; diff?: string };
}

export type { ToolPermissionMode };

export const BUILTIN_AGENT_TOOLS: MagiToolDefinition[] = getBuiltinToolDefinitions();

export async function executeBuiltinAgentTool(input: {
  cwd: string;
  toolUse: MagiToolUsePart;
  env?: NodeJS.ProcessEnv;
  userIntent?: string;
  disabledToolNames?: string[];
  stateRoot?: string;
  outputRoot?: string;
  kiraWorkspaceRoot?: string;
  sessionId?: string;
  webSearchConfig?: WebSearchConfig;
  permissionMode?: ToolPermissionMode;
  promptModel?: (request: { messages: MagiMessage[] }) => Promise<{ text: string }>;
  userQuestionResolver?: UserQuestionResolver;
  userMessageSink?: UserMessageSink;
  spawnSubAgent?: (request: SubAgentRequest) => Promise<SubAgentResult>;
  approvalResolver?: (request: { toolUse: MagiToolUsePart; permission: { decision: "allow" | "ask" | "deny"; reason: string; diff?: string } }) => Promise<boolean> | boolean;
}): Promise<AgentToolResult> {
  return executeRegisteredTool({
    cwd: input.cwd,
    toolUse: input.toolUse,
    env: input.env,
    userIntent: input.userIntent,
    disabledToolNames: input.disabledToolNames,
    stateRoot: input.stateRoot,
    outputRoot: input.outputRoot,
    kiraWorkspaceRoot: input.kiraWorkspaceRoot,
    sessionId: input.sessionId,
    webSearchConfig: input.webSearchConfig,
    permissionMode: input.permissionMode ?? "acceptEdits",
    promptModel: input.promptModel,
    userQuestionResolver: input.userQuestionResolver,
    userMessageSink: input.userMessageSink,
    spawnSubAgent: input.spawnSubAgent,
    approvalResolver: input.approvalResolver
  });
}

export async function executeBuiltinAgentTools(input: {
  cwd: string;
  toolUses: MagiToolUsePart[];
  env?: NodeJS.ProcessEnv;
  userIntent?: string;
  disabledToolNames?: string[];
  stateRoot?: string;
  outputRoot?: string;
  kiraWorkspaceRoot?: string;
  sessionId?: string;
  webSearchConfig?: WebSearchConfig;
  permissionMode?: ToolPermissionMode;
  promptModel?: (request: { messages: MagiMessage[] }) => Promise<{ text: string }>;
  userQuestionResolver?: UserQuestionResolver;
  userMessageSink?: UserMessageSink;
  spawnSubAgent?: (request: SubAgentRequest) => Promise<SubAgentResult>;
  approvalResolver?: (request: { toolUse: MagiToolUsePart; permission: { decision: "allow" | "ask" | "deny"; reason: string; diff?: string } }) => Promise<boolean> | boolean;
}): Promise<AgentToolResult[]> {
  return executeRegisteredTools({
    cwd: input.cwd,
    toolUses: input.toolUses,
    env: input.env,
    userIntent: input.userIntent,
    disabledToolNames: input.disabledToolNames,
    stateRoot: input.stateRoot,
    outputRoot: input.outputRoot,
    kiraWorkspaceRoot: input.kiraWorkspaceRoot,
    sessionId: input.sessionId,
    webSearchConfig: input.webSearchConfig,
    permissionMode: input.permissionMode ?? "acceptEdits",
    promptModel: input.promptModel,
    userQuestionResolver: input.userQuestionResolver,
    userMessageSink: input.userMessageSink,
    spawnSubAgent: input.spawnSubAgent,
    approvalResolver: input.approvalResolver
  });
}
