import type { AgentKind } from "./agent.ts";

export const hostClaudeWarningMessage =
  "macbox: WARNING: auto-enabled host-claude profile (grants ~/.claude read/write). " +
  "Use --no-host-claude-profile to disable.";

export const hostToolsInfoMessage =
  "macbox: auto-enabled host-tools profile (agent under HOME)";

export type HostProfileDecision = {
  readonly autoProfile: "host-claude" | "host-tools" | null;
  readonly logLevel: "warning" | "info" | null;
  readonly logMessage: string | null;
};

export const decideAutoHostProfile = (args: {
  readonly effectiveAgent: AgentKind;
  readonly resolvedAgentPath: string;
  readonly homeDir: string;
  readonly disableHostClaudeProfile: boolean;
}): HostProfileDecision => {
  const underHome = !!args.homeDir &&
    args.resolvedAgentPath.startsWith(`${args.homeDir}/`);

  if (underHome) {
    if (args.effectiveAgent === "claude") {
      if (args.disableHostClaudeProfile) {
        return { autoProfile: null, logLevel: null, logMessage: null };
      }
      return {
        autoProfile: "host-claude",
        logLevel: "warning",
        logMessage: hostClaudeWarningMessage,
      };
    }
    return {
      autoProfile: "host-tools",
      logLevel: "info",
      logMessage: hostToolsInfoMessage,
    };
  }

  if (args.effectiveAgent === "claude" && !args.disableHostClaudeProfile) {
    return {
      autoProfile: "host-claude",
      logLevel: "warning",
      logMessage: hostClaudeWarningMessage,
    };
  }

  return { autoProfile: null, logLevel: null, logMessage: null };
};

export const shouldLinkHostClaude = (
  effectiveAgent: AgentKind,
  profileNames: ReadonlyArray<string>,
): boolean =>
  effectiveAgent === "claude" && profileNames.includes("host-claude");
