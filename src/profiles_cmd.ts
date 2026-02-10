import { parseArgs } from "./mini_args.ts";
import { listAvailableProfiles, loadProfilesOptional } from "./profiles.ts";
import { boolFlag, requireStringFlag } from "./flags.ts";

export const profilesCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const json = boolFlag(a.flags.json, false);
  const [sub, ...rest] = a._;

  const usage = () => {
    console.log(
      [
        "macbox profiles — manage sandbox profile snippets",
        "",
        "Usage:",
        "  macbox profiles list [--json]",
        "  macbox profiles show <name> [--json]",
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
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.profiles.list.v1",
            profiles: names,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      for (const n of names) console.log(n);
      return { code: 0 };
    }
    case "show": {
      const name = rest[0] ?? requireStringFlag("name", a.flags.name);
      if (!name) {
        usage();
        return { code: 2 };
      }
      // We don't need a real worktree to show; resolve relative paths against '.'
      const loaded = await loadProfilesOptional(
        Deno.cwd(),
        [name],
        new Set<string>(),
      );
      for (const w of loaded.warnings) {
        console.error(`macbox: WARNING: ${w}`);
      }
      const p = loaded.profiles[0];
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.profiles.show.v1",
            profile: p,
            warnings: loaded.warnings,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      console.log(JSON.stringify(p, null, 2));
      return { code: 0 };
    }
    default:
      usage();
      return { code: 2 };
  }
};
