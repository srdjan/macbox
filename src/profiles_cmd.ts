import { parseArgs } from "./mini_args.ts";
import { listAvailableProfiles, loadProfiles } from "./profiles.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === "string" ? v : v ? "true" : "false";

export const profilesCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const [sub, ...rest] = a._;

  const usage = () => {
    console.log(
      [
        "macbox profiles — manage sandbox profile snippets",
        "",
        "Usage:",
        "  macbox profiles list",
        "  macbox profiles show <name>",
        "",
        "Notes:",
        "  - Profiles are loaded from:",
        "      1) ~/.config/macbox/profiles/<name>.json",
        "      2) <repo>/profiles/<name>.json (bundled)",
      ].join("\n"),
    );
  };

  if (!sub || sub === "help" || a.flags.help) {
    usage();
    return { code: 0 };
  }

  switch (sub) {
    case "list": {
      const names = await listAvailableProfiles();
      for (const n of names) console.log(n);
      return { code: 0 };
    }
    case "show": {
      const name = rest[0] ?? asString(a.flags.name);
      if (!name) {
        usage();
        return { code: 2 };
      }
      // We don't need a real worktree to show; resolve relative paths against '.'
      const loaded = await loadProfiles(Deno.cwd(), [name]);
      const p = loaded.profiles[0];
      console.log(JSON.stringify(p, null, 2));
      return { code: 0 };
    }
    default:
      usage();
      return { code: 2 };
  }
};
