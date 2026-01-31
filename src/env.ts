import { macboxCache, macboxHome, macboxTmp } from "./paths.ts";
import type { AgentKind } from "./agent.ts";

export const sandboxEnv = (worktreePath: string, agent?: AgentKind): Record<string, string> => {
  const home = macboxHome(worktreePath);
  const cache = macboxCache(worktreePath);
  const tmp = macboxTmp(worktreePath);

  // Keep PATH practical for dev tools.
  const path = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");

  const env: Record<string, string> = {
    HOME: home,
    PATH: path,

    // Put “user space” inside the worktree
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_CACHE_HOME: cache,
    TMPDIR: tmp,

    // Common tool caches
    DENO_DIR: `${cache}/deno`,
    NPM_CONFIG_CACHE: `${cache}/npm`,
    YARN_CACHE_FOLDER: `${cache}/yarn`,
    PNPM_HOME: `${home}/.local/share/pnpm`,

    // Avoid reading host global git config by default
    GIT_CONFIG_GLOBAL: `${home}/.gitconfig`,
    GIT_CONFIG_SYSTEM: "/dev/null",
  };

  if (agent === "codex") {
    // Keep Codex config + auth inside the sandbox home rather than ~/.codex on the host.
    env.CODEX_HOME = `${home}/.codex`;
  }

  // Pass through API keys from host environment if present
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    env.ANTHROPIC_API_KEY = anthropicKey;
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey) {
    env.OPENAI_API_KEY = openaiKey;
  }

  return env;
};
