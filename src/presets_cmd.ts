import { parseArgs } from "./mini_args.ts";
import {
  listAvailablePresets,
  loadPreset,
} from "./presets.ts";
import { asString } from "./flags.ts";

const usage = () => {
  console.log(
    [
      "macbox presets - list and inspect agent configuration presets",
      "",
      "Usage:",
      "  macbox presets list",
      "  macbox presets show <name>",
      "",
      "Notes:",
      "  - Presets are loaded from:",
      "      1) ~/.config/macbox/presets/<name>.json",
      "      2) <repo>/presets/<name>.json (bundled)",
      "  - Use --preset <name> with macbox to apply a preset",
      "  - Edit preset files directly with your preferred editor",
    ].join("\n")
  );
};

export const presetsCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const [sub, ...rest] = a._;

  if (!sub || sub === "help" || a.flags.help) {
    usage();
    return { code: 0 };
  }

  switch (sub) {
    case "list": {
      const names = await listAvailablePresets();
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
      console.log(JSON.stringify(loaded.preset, null, 2));
      return { code: 0 };
    }

    default:
      usage();
      return { code: 2 };
  }
};
