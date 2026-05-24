import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AgentInstructionFile {
  path: string;
  directory: string;
  content: string;
}

export function loadAgentInstructions(cwd: string, stopAt = path.parse(cwd).root): AgentInstructionFile[] {
  const dirs = directoriesFromRoot(cwd, stopAt);
  const files: AgentInstructionFile[] = [];
  for (const dir of dirs) {
    const file = path.join(dir, "AGENTS.md");
    if (existsSync(file)) {
      files.push({
        path: file,
        directory: dir,
        content: readFileSync(file, "utf8")
      });
    }
  }
  return files;
}

export function formatAgentInstructions(files: AgentInstructionFile[]): string {
  if (files.length === 0) {
    return "No AGENTS.md instructions found\n";
  }
  return `${files.map((file) => [
    `# ${file.path}`,
    file.content.trimEnd()
  ].join("\n")).join("\n\n")}\n`;
}

function directoriesFromRoot(cwd: string, stopAt: string): string[] {
  const absoluteCwd = path.resolve(cwd);
  const absoluteStop = path.resolve(stopAt);
  const dirs: string[] = [];
  let current = absoluteCwd;
  while (true) {
    dirs.unshift(current);
    if (current === absoluteStop || current === path.dirname(current)) {
      break;
    }
    current = path.dirname(current);
  }
  if (absoluteStop === path.parse(absoluteStop).root) {
    return dirs;
  }
  return dirs.filter((dir) => dir === absoluteStop || dir.startsWith(`${absoluteStop}${path.sep}`));
}
