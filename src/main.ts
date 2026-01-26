#!/usr/bin/env -S deno run -A
import { parseArgs } from "./mini_args.ts";
import { runCmd } from "./run.ts";
import { shellCmd } from "./shell.ts";
import { cleanCmd } from "./clean.ts";
import { profilesCmd } from "./profiles_cmd.ts";
import { sessionsCmd } from "./sessions_cmd.ts";
import { attachCmd } from "./attach.ts";
import { skillsCmd } from "./skills_cmd.ts";
import { printHelp } from "./usage.ts";

export type Exit = { readonly code: number };

const main = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const top = parseArgs(argv);

  if (top.flags.help || top._.length === 0) {
    printHelp();
    return { code: 0 };
  }

  const [cmd, ...rest] = top._;

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
