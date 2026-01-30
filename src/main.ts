#!/usr/bin/env -S deno run -A
import { parseArgs } from "./mini_args.ts";
import { cleanCmd } from "./clean.ts";
import { profilesCmd } from "./profiles_cmd.ts";
import { sessionsCmd } from "./sessions_cmd.ts";
import { skillsCmd } from "./skills_cmd.ts";
import { presetsCmd } from "./presets_cmd.ts";
import { projectCmd } from "./project_cmd.ts";
import { workspaceCmd } from "./workspace_cmd.ts";
import { flowCmd } from "./flow_cmd.ts";
import { contextCmd } from "./context_cmd.ts";
import { agentCmd } from "./agent_cmd.ts";
import { printHelp, printMinimalHelp } from "./usage.ts";

export type Exit = { readonly code: number };

const main = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const top = parseArgs(argv);

  if (top.flags["help-all"]) {
    printHelp();
    return { code: 0 };
  }

  if (top.flags.help || argv.length === 0) {
    printMinimalHelp();
    return { code: 0 };
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === "-p") {
    throw new Error("macbox: -p is not supported. Use --prompt instead.");
  }

  switch (cmd) {
    case "claude":
    case "codex":
      throw new Error(
        `macbox: '${cmd}' subcommand removed. Agent is now configured via presets or macbox.json defaults.\n` +
        `  Use: macbox --preset <name>  or set defaults.preset in macbox.json`,
      );
    case "clean":
      return await cleanCmd(rest);
    case "profiles":
      return await profilesCmd(rest);
    case "sessions":
      return await sessionsCmd(rest);
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
    case "help":
      printMinimalHelp();
      return { code: 0 };
    default:
      return await agentCmd(argv);
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
