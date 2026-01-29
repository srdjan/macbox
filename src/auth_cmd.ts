import { parseArgs } from "./mini_args.ts";
import type { Exit } from "./main.ts";
import { runInteractive } from "./exec.ts";
import { resolveAgentPath } from "./agent_detect.ts";
import type { AgentKind } from "./agent.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === "string" ? v : v ? "true" : "false";

const isAgent = (v: string): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

export const authCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const agentRaw = asString(a.flags.agent) ?? a._[0];
  if (!agentRaw || !isAgent(agentRaw) || agentRaw === "custom") {
    console.error("macbox authenticate: specify --agent claude|codex");
    return { code: 2 };
  }
  const agent = agentRaw as AgentKind;

  const cmdOverride = asString(a.flags.cmd);
  const exe = cmdOverride ?? await resolveAgentPath(agent);
  if (!exe) {
    console.error(`macbox authenticate: '${agent}' not found on PATH. Use --cmd /path/to/${agent}.`);
    return { code: 2 };
  }

  const passthrough = a.passthrough;
  const base = (() => {
    if (agent === "claude") return [exe, "setup-token"];
    if (agent === "codex") return [exe];
    return [exe];
  })();

  const cmd = passthrough.length ? [exe, ...passthrough] : base;

  console.error("macbox authenticate: running auth flow outside sandbox");
  const code = await runInteractive(cmd);
  if (code !== 0) {
    console.error(
      `macbox authenticate: command exited with code ${code}. ` +
        "If this is unsupported, run the agent's own auth command directly.",
    );
  }
  return { code };
};
