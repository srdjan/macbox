export type AgentKind = "claude" | "codex" | "custom";

export const defaultAgentCmd = (k: AgentKind): ReadonlyArray<string> => {
  switch (k) {
    case "claude":
      // Claude Code CLI typically installs as `claude`.
      return ["claude"];
    case "codex":
      // Codex CLI typically installs as `codex`.
      return ["codex"];
    default:
      return [];
  }
};

/**
 * Agent "bundled" profiles that macbox will auto-apply when you pass --agent.
 * These are *additive* and can be further composed with --profile.
 */
export const defaultAgentProfiles = (k: AgentKind): ReadonlyArray<string> => {
  switch (k) {
    case "claude":
      return ["agent-claude"];
    case "codex":
      return ["agent-codex"];
    default:
      return [];
  }
};
