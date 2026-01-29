// Auto-authentication: detect missing credentials and trigger agent auth flow.

import { runInteractive } from "./exec.ts";
import type { AgentKind } from "./agent.ts";

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

/** Check if the agent likely has valid credentials on the host. */
export const hasCredentials = async (agent: AgentKind): Promise<boolean> => {
  const home = Deno.env.get("HOME") ?? "";

  if (agent === "claude") {
    if (Deno.env.get("ANTHROPIC_API_KEY")) return true;
    // Claude Code stores internal auth state under ~/.claude/
    if (home && await pathExists(`${home}/.claude`)) return true;
    return false;
  }

  if (agent === "codex") {
    if (Deno.env.get("OPENAI_API_KEY")) return true;
    if (home && await pathExists(`${home}/.codex/auth.json`)) return true;
    return false;
  }

  // custom agent: skip auth check
  return true;
};

/** Run the agent's auth flow interactively. Returns exit code. */
export const runAuthFlow = async (
  agent: AgentKind,
  exe: string,
): Promise<number> => {
  const cmd = agent === "claude" ? [exe, "setup-token"] : [exe];
  console.log(`macbox: ${agent} not authenticated. Running setup...`);
  return await runInteractive(cmd);
};

/** Check credentials and auto-trigger auth if missing. Throws on failure. */
export const ensureAuthenticated = async (
  agent: AgentKind,
  exe: string,
): Promise<void> => {
  if (await hasCredentials(agent)) return;
  const code = await runAuthFlow(agent, exe);
  if (code !== 0) {
    throw new Error(
      `macbox: authentication failed (exit ${code}). Run '${exe} setup-token' manually.`,
    );
  }
};
