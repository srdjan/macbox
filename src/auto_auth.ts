// Auto-authentication: detect missing credentials and trigger agent auth flow.

import { runInteractive } from "./exec.ts";
import type { AgentKind } from "./agent.ts";

/** Check if the agent likely has valid credentials on the host. */
export const hasCredentials = async (agent: AgentKind): Promise<boolean> => {
  if (agent === "claude") {
    // Check for ANTHROPIC_API_KEY first
    const hasKey = !!Deno.env.get("ANTHROPIC_API_KEY");
    if (hasKey) return true;

    // Check for existing Claude session/OAuth token in ~/.claude
    const home = Deno.env.get("HOME");
    if (home) {
      const claudeDir = `${home}/.claude`;
      try {
        const stat = await Deno.stat(claudeDir);
        if (stat.isDirectory) {
          // If ~/.claude exists and has been used recently (has files), assume authenticated
          try {
            const entries = [];
            for await (const entry of Deno.readDir(claudeDir)) {
              entries.push(entry);
              if (entries.length > 0) return true; // Has session files
            }
          } catch {
            // Can't read directory, fall through to show API key message
          }
        }
      } catch {
        // ~/.claude doesn't exist
      }
    }

    console.error("macbox: ANTHROPIC_API_KEY not set and no existing Claude session found");
    console.error("  Set it in your shell profile:");
    console.error("    export ANTHROPIC_API_KEY=sk-ant-...");
    console.error("  Or get your key from: https://console.anthropic.com/settings/keys");
    return false;
  }

  if (agent === "codex") {
    const hasKey = !!Deno.env.get("OPENAI_API_KEY");
    if (!hasKey) {
      console.error("macbox: OPENAI_API_KEY not set");
      console.error("  Set it in your shell profile:");
      console.error("    export OPENAI_API_KEY=sk-...");
    }
    return hasKey;
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
