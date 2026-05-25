export interface ModelCapabilities {
  family: string;
  role?: "haiku" | "sonnet" | "opus" | "main";
  contextWindow: number;
  supportsVision: boolean;
  specialty?: "coding" | "reasoning" | "vision" | "general";
  priority?: number;
}
