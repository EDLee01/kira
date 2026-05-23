import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { atomicWrite } from "./fs-utils.ts";
import { MagiPaths } from "./paths.ts";

export type GoalStatus = "active" | "complete" | "blocked";

export interface ThreadGoal {
  id: string;
  sessionId: string;
  objective: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedAt?: string;
  note?: string;
}

interface GoalStoreData {
  version: 1;
  goals: ThreadGoal[];
}

export function goalStorePath(paths: MagiPaths): string {
  return path.join(paths.stateRoot, "goals.json");
}

export function getGoal(paths: MagiPaths, sessionId: string): ThreadGoal | undefined {
  return readGoalStore(paths).goals.find((goal) => goal.sessionId === sessionId && goal.status === "active");
}

export function listGoals(paths: MagiPaths, sessionId?: string): ThreadGoal[] {
  const goals = readGoalStore(paths).goals;
  return (sessionId ? goals.filter((goal) => goal.sessionId === sessionId) : goals)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createGoal(paths: MagiPaths, input: { sessionId: string; objective: string }): ThreadGoal {
  const objective = input.objective.trim();
  if (!objective) {
    throw new Error("Goal objective must not be empty");
  }
  const data = readGoalStore(paths);
  const now = new Date().toISOString();
  for (const goal of data.goals) {
    if (goal.sessionId === input.sessionId && goal.status === "active") {
      goal.status = "blocked";
      goal.blockedAt = now;
      goal.updatedAt = now;
      goal.note = "Superseded by a new active goal";
    }
  }
  const goal: ThreadGoal = {
    id: randomUUID(),
    sessionId: input.sessionId,
    objective,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  data.goals.push(goal);
  writeGoalStore(paths, data);
  return goal;
}

export function updateGoalStatus(paths: MagiPaths, input: {
  sessionId: string;
  status: Exclude<GoalStatus, "active">;
  note?: string;
}): ThreadGoal | undefined {
  const data = readGoalStore(paths);
  const goal = data.goals.find((candidate) => candidate.sessionId === input.sessionId && candidate.status === "active");
  if (!goal) return undefined;
  const now = new Date().toISOString();
  goal.status = input.status;
  goal.updatedAt = now;
  goal.note = input.note?.trim() || undefined;
  if (input.status === "complete") goal.completedAt = now;
  if (input.status === "blocked") goal.blockedAt = now;
  writeGoalStore(paths, data);
  return goal;
}

export function clearGoal(paths: MagiPaths, sessionId: string, note = "Cleared by user"): ThreadGoal | undefined {
  return updateGoalStatus(paths, { sessionId, status: "blocked", note });
}

export function formatGoal(goal: ThreadGoal | undefined): string {
  if (!goal) return "No active goal.";
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Session: ${goal.sessionId}`,
    `Created: ${goal.createdAt}`,
    goal.note ? `Note: ${goal.note}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function formatGoalContext(goal: ThreadGoal | undefined): string | undefined {
  if (!goal || goal.status !== "active") return undefined;
  return [
    "<active_thread_goal>",
    "Continue working toward this session goal unless the user redirects or explicitly changes it.",
    `Objective: ${goal.objective}`,
    "Keep progress aligned with the full objective. Do not mark it done unless current evidence proves completion.",
    "</active_thread_goal>"
  ].join("\n");
}

export function executeGoalCommand(paths: MagiPaths, sessionId: string, text: string): string {
  const parts = text.trim().split(/\s+/);
  const command = parts[0] ?? "";
  if (command !== "/goal") {
    throw new Error(`Unsupported goal command: ${command}`);
  }

  const action = parts[1]?.toLowerCase();
  if (!action || action === "status") {
    return formatGoal(getGoal(paths, sessionId));
  }

  if (action === "list") {
    const goals = listGoals(paths, sessionId);
    if (goals.length === 0) return "No goals have been recorded for this session.";
    return goals.map((goal, index) => [
      `${index + 1}. ${goal.objective}`,
      `   Status: ${goal.status}`,
      `   Updated: ${goal.updatedAt}`,
      goal.note ? `   Note: ${goal.note}` : undefined
    ].filter((line): line is string => Boolean(line)).join("\n")).join("\n");
  }

  if (action === "done" || action === "complete") {
    const note = text.trim().split(/\s+/).slice(2).join(" ");
    const goal = updateGoalStatus(paths, { sessionId, status: "complete", note });
    return goal ? `Goal marked complete.\n${formatGoal(goal)}` : "No active goal to complete.";
  }

  if (action === "blocked") {
    const note = text.trim().split(/\s+/).slice(2).join(" ");
    const goal = updateGoalStatus(paths, { sessionId, status: "blocked", note });
    return goal ? `Goal marked blocked.\n${formatGoal(goal)}` : "No active goal to block.";
  }

  if (action === "clear") {
    const note = text.trim().split(/\s+/).slice(2).join(" ") || "Cleared by user";
    const goal = clearGoal(paths, sessionId, note);
    return goal ? `Goal cleared.\n${formatGoal(goal)}` : "No active goal to clear.";
  }

  const objective = text.trim().slice("/goal".length).trim();
  const goal = createGoal(paths, { sessionId, objective });
  return `Goal saved.\n${formatGoal(goal)}`;
}

function readGoalStore(paths: MagiPaths): GoalStoreData {
  const file = goalStorePath(paths);
  if (!existsSync(file)) {
    return { version: 1, goals: [] };
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<GoalStoreData>;
  return {
    version: 1,
    goals: Array.isArray(parsed.goals) ? parsed.goals.filter(isGoal) : []
  };
}

function writeGoalStore(paths: MagiPaths, data: GoalStoreData): void {
  mkdirSync(paths.stateRoot, { recursive: true });
  atomicWrite(goalStorePath(paths), `${JSON.stringify(data, null, 2)}\n`);
}

function isGoal(value: unknown): value is ThreadGoal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.sessionId === "string"
    && typeof record.objective === "string"
    && (record.status === "active" || record.status === "complete" || record.status === "blocked")
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string";
}
