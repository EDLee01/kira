import { MagiMessage, MagiToolDefinition, MagiToolUsePart } from "../providers/ir.ts";
import { WebSearchConfig } from "../config.ts";
import {
  executeRegisteredTool,
  executeRegisteredTools,
  type BuiltinToolDefinitionOptions,
  getBuiltinToolDefinitions,
  type ComputerUseTeachStepResolver,
  type ComputerUseContext,
  type SubAgentRequest,
  type SubAgentResult,
  type ToolApprovalDecision,
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

export function getBuiltinAgentTools(options: BuiltinToolDefinitionOptions = {}): MagiToolDefinition[] {
  return getBuiltinToolDefinitions(options);
}

export async function executeBuiltinAgentTool(input: {
  cwd: string;
  toolUse: MagiToolUsePart;
  env?: NodeJS.ProcessEnv;
  userIntent?: string;
  disabledToolNames?: string[];
  stateRoot?: string;
  memoryRoot?: string;
  outputRoot?: string;
  kiraWorkspaceRoot?: string;
  sessionId?: string;
  webSearchConfig?: WebSearchConfig;
  permissionMode?: ToolPermissionMode;
  promptModel?: (request: { messages: MagiMessage[] }) => Promise<{ text: string }>;
  userQuestionResolver?: UserQuestionResolver;
  userMessageSink?: UserMessageSink;
  spawnSubAgent?: (request: SubAgentRequest) => Promise<SubAgentResult>;
  signal?: AbortSignal;
  computerUseTeachStepResolver?: ComputerUseTeachStepResolver;
  computerUseHideHostWindow?: ComputerUseContext["hideHostWindow"];
  computerUseTeachModeActivated?: ComputerUseContext["teachModeActivated"];
  computerUseTeachModeExited?: ComputerUseContext["teachModeExited"];
  computerUseDeniedBundleIds?: string[];
  approvalResolver?: (request: { toolUse: MagiToolUsePart; permission: { decision: "allow" | "ask" | "deny"; reason: string; diff?: string } }) => Promise<ToolApprovalDecision> | ToolApprovalDecision;
}): Promise<AgentToolResult> {
  return executeRegisteredTool({
    cwd: input.cwd,
    toolUse: input.toolUse,
    env: input.env,
    userIntent: input.userIntent,
    disabledToolNames: input.disabledToolNames,
    stateRoot: input.stateRoot,
    memoryRoot: input.memoryRoot,
    outputRoot: input.outputRoot,
    kiraWorkspaceRoot: input.kiraWorkspaceRoot,
    sessionId: input.sessionId,
    webSearchConfig: input.webSearchConfig,
    permissionMode: input.permissionMode ?? "acceptEdits",
    promptModel: input.promptModel,
    userQuestionResolver: input.userQuestionResolver,
    userMessageSink: input.userMessageSink,
    spawnSubAgent: input.spawnSubAgent,
    signal: input.signal,
    computerUseTeachStepResolver: input.computerUseTeachStepResolver,
    computerUseHideHostWindow: input.computerUseHideHostWindow,
    computerUseTeachModeActivated: input.computerUseTeachModeActivated,
    computerUseTeachModeExited: input.computerUseTeachModeExited,
    computerUseDeniedBundleIds: input.computerUseDeniedBundleIds,
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
  memoryRoot?: string;
  outputRoot?: string;
  kiraWorkspaceRoot?: string;
  sessionId?: string;
  webSearchConfig?: WebSearchConfig;
  permissionMode?: ToolPermissionMode;
  promptModel?: (request: { messages: MagiMessage[] }) => Promise<{ text: string }>;
  userQuestionResolver?: UserQuestionResolver;
  userMessageSink?: UserMessageSink;
  spawnSubAgent?: (request: SubAgentRequest) => Promise<SubAgentResult>;
  signal?: AbortSignal;
  computerUseTeachStepResolver?: ComputerUseTeachStepResolver;
  computerUseHideHostWindow?: ComputerUseContext["hideHostWindow"];
  computerUseTeachModeActivated?: ComputerUseContext["teachModeActivated"];
  computerUseTeachModeExited?: ComputerUseContext["teachModeExited"];
  computerUseDeniedBundleIds?: string[];
  approvalResolver?: (request: { toolUse: MagiToolUsePart; permission: { decision: "allow" | "ask" | "deny"; reason: string; diff?: string } }) => Promise<ToolApprovalDecision> | ToolApprovalDecision;
}): Promise<AgentToolResult[]> {
  return executeRegisteredTools({
    cwd: input.cwd,
    toolUses: input.toolUses,
    env: input.env,
    userIntent: input.userIntent,
    disabledToolNames: input.disabledToolNames,
    stateRoot: input.stateRoot,
    memoryRoot: input.memoryRoot,
    outputRoot: input.outputRoot,
    kiraWorkspaceRoot: input.kiraWorkspaceRoot,
    sessionId: input.sessionId,
    webSearchConfig: input.webSearchConfig,
    permissionMode: input.permissionMode ?? "acceptEdits",
    promptModel: input.promptModel,
    userQuestionResolver: input.userQuestionResolver,
    userMessageSink: input.userMessageSink,
    spawnSubAgent: input.spawnSubAgent,
    signal: input.signal,
    computerUseTeachStepResolver: input.computerUseTeachStepResolver,
    computerUseHideHostWindow: input.computerUseHideHostWindow,
    computerUseTeachModeActivated: input.computerUseTeachModeActivated,
    computerUseTeachModeExited: input.computerUseTeachModeExited,
    computerUseDeniedBundleIds: input.computerUseDeniedBundleIds,
    approvalResolver: input.approvalResolver
  });
}
