import { exec } from "./exec.ts";
import type { AgentKind } from "./agent.ts";

export type AgentAvailability = {
  readonly claude: boolean;
  readonly codex: boolean;
};

const hasBin = async (bin: string): Promise<boolean> => {
  const r = await exec(["which", bin], { quiet: true });
  return r.code === 0 && r.stdout.trim().length > 0;
};

export const detectAgents = async (): Promise<AgentAvailability> => ({
  claude: await hasBin("claude"),
  codex: await hasBin("codex"),
});

export const resolveAgentPath = async (
  agent: AgentKind,
): Promise<string | null> => {
  if (agent !== "claude" && agent !== "codex") return null;
  const r = await exec(["which", agent], { quiet: true });
  if (r.code !== 0) return null;
  const p = r.stdout.trim();
  return p.length ? p : null;
};

export const pickDefaultAgent = (
  avail: AgentAvailability,
): { readonly agent?: AgentKind; readonly ambiguous: boolean } => {
  if (avail.claude && !avail.codex) {
    return { agent: "claude", ambiguous: false };
  }
  if (!avail.claude && avail.codex) return { agent: "codex", ambiguous: false };
  if (avail.claude && avail.codex) return { agent: "claude", ambiguous: true };
  return { agent: undefined, ambiguous: false };
};
