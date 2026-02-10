import { parseArgs } from "./mini_args.ts";
import { listAvailablePresets, loadPreset } from "./presets.ts";
import { asString, boolFlag } from "./flags.ts";

const usage = () => {
  console.log(
    [
      "macbox presets - list and inspect agent configuration presets",
      "",
      "Usage:",
      "  macbox presets list [--json]",
      "  macbox presets show <name> [--json]",
      "",
      "Notes:",
      "  - Presets are loaded from:",
      "      1) ~/.config/macbox/presets/<name>.json",
      "      2) <repo>/presets/<name>.json (bundled)",
      "  - Use --preset <name> with macbox to apply a preset",
      "  - Edit preset files directly with your preferred editor",
    ].join("\n"),
  );
};

export const presetsCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const json = boolFlag(a.flags.json, false);
  const [sub, ...rest] = a._;

  if (!sub || sub === "help" || a.flags.help) {
    usage();
    return { code: 0 };
  }

  switch (sub) {
    case "list": {
      const names = await listAvailablePresets();
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.presets.list.v1",
            presets: names,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      if (names.length === 0) {
        console.log("No presets found.");
      } else {
        for (const n of names) console.log(n);
      }
      return { code: 0 };
    }

    case "show": {
      const name = rest[0] ?? asString(a.flags.name);
      if (!name) {
        usage();
        return { code: 2 };
      }
      const loaded = await loadPreset(name);
      for (const w of loaded.warnings) {
        console.error(`macbox: WARNING: ${w}`);
      }
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.presets.show.v1",
            preset: loaded.preset,
            source: loaded.source,
            warnings: loaded.warnings,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      console.log(JSON.stringify(loaded.preset, null, 2));
      return { code: 0 };
    }

    default:
      usage();
      return { code: 2 };
  }
};
