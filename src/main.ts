#!/usr/bin/env -S deno run -A
import { parseArgs } from "./mini_args.ts";
import { runCmd } from "./run.ts";
import { shellCmd } from "./shell.ts";
import { cleanCmd } from "./clean.ts";
import { profilesCmd } from "./profiles_cmd.ts";
import { sessionsCmd } from "./sessions_cmd.ts";
import { attachCmd } from "./attach.ts";
import { skillsCmd } from "./skills_cmd.ts";
import { presetsCmd } from "./presets_cmd.ts";
import { projectCmd } from "./project_cmd.ts";
import { workspaceCmd } from "./workspace_cmd.ts";
import { flowCmd } from "./flow_cmd.ts";
import { contextCmd } from "./context_cmd.ts";
import { startCmd } from "./start.ts";
import { authCmd } from "./auth_cmd.ts";
import { printHelp } from "./usage.ts";

export type Exit = { readonly code: number };

const main = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const top = parseArgs(argv);

  if (top.flags.help || argv.length === 0) {
    printHelp();
    return { code: 0 };
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "run":
      return await runCmd(rest);
    case "shell":
      return await shellCmd(rest);
    case "clean":
      return await cleanCmd(rest);
    case "profiles":
      return await profilesCmd(rest);
    case "sessions":
      return await sessionsCmd(rest);
    case "attach":
      return await attachCmd(rest);
    case "skills":
      return await skillsCmd(rest);
    case "presets":
      return await presetsCmd(rest);
    case "project":
      return await projectCmd(rest);
    case "workspace":
    case "ws":
      return await workspaceCmd(rest);
    case "flow":
      return await flowCmd(rest);
    case "context":
      return await contextCmd(rest);
    case "start":
      return await startCmd(rest);
    case "claude":
      return await startCmd(["--agent", "claude", ...rest]);
    case "codex":
      return await startCmd(["--agent", "codex", ...rest]);
    case "authenticate":
    case "auth":
      return await authCmd(rest);
    case "help":
    default:
      printHelp();
      return { code: cmd === "help" ? 0 : 2 };
  }
};

if (import.meta.main) {
  try {
    const { code } = await main(Deno.args);
    Deno.exit(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    Deno.exit(1);
  }
}
