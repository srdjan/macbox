import { parseArgs } from "./mini_args.ts";
import { ensureDir } from "./fs.ts";
import {
  defaultPresetTemplate,
  listAvailablePresets,
  loadPreset,
  resolvePresetFile,
  userPresetsDir,
} from "./presets.ts";
import { pathJoin } from "./os.ts";
import { asString } from "./flags.ts";

const usage = () => {
  console.log(
    [
      "macbox presets - manage agent configuration presets",
      "",
      "Usage:",
      "  macbox presets list",
      "  macbox presets show <name>",
      "  macbox presets create <name> [--template <preset>]",
      "  macbox presets edit <name>",
      "  macbox presets delete <name>",
      "",
      "Notes:",
      "  - Presets are loaded from:",
      "      1) ~/.config/macbox/presets/<name>.json",
      "      2) <repo>/presets/<name>.json (bundled)",
      "  - Use --preset <name> with 'run' or 'shell' to apply a preset",
    ].join("\n")
  );
};

const openInEditor = async (filePath: string): Promise<number> => {
  const editor = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL") ?? "vi";
  const cmd = new Deno.Command(editor, {
    args: [filePath],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const proc = cmd.spawn();
  const status = await proc.status;
  return status.code;
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

    case "create": {
      const name = rest[0] ?? asString(a.flags.name);
      if (!name) {
        console.error("presets create: missing <name>");
        usage();
        return { code: 2 };
      }

      const templateName = asString(a.flags.template);
      const userDir = userPresetsDir();
      const destPath = pathJoin(userDir, `${name}.json`);

      // Check if preset already exists in user dir
      try {
        await Deno.stat(destPath);
        throw new Error(`Preset already exists: ${destPath}`);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }

      await ensureDir(userDir);

      let presetContent: object;
      if (templateName) {
        const loaded = await loadPreset(templateName);
        presetContent = { ...loaded.preset, name };
      } else {
        presetContent = defaultPresetTemplate(name);
      }

      await Deno.writeTextFile(
        destPath,
        JSON.stringify(presetContent, null, 2) + "\n"
      );
      console.log(`Created preset: ${destPath}`);
      return { code: 0 };
    }

    case "edit": {
      const name = rest[0] ?? asString(a.flags.name);
      if (!name) {
        console.error("presets edit: missing <name>");
        usage();
        return { code: 2 };
      }

      // First check if it exists in user dir
      const userDir = userPresetsDir();
      const userPath = pathJoin(userDir, `${name}.json`);

      try {
        await Deno.stat(userPath);
        const code = await openInEditor(userPath);
        return { code };
      } catch {
        // Not in user dir, check if it exists elsewhere
        const candidates = resolvePresetFile(name);
        let foundPath: string | null = null;
        for (const c of candidates) {
          try {
            await Deno.stat(c);
            foundPath = c;
            break;
          } catch {
            continue;
          }
        }

        if (!foundPath) {
          throw new Error(
            `Preset not found: ${name} (searched: ${candidates.join(", ")})`
          );
        }

        // Found in bundled dir, copy to user dir first
        console.log(`Copying bundled preset to user dir for editing...`);
        await ensureDir(userDir);
        const content = await Deno.readTextFile(foundPath);
        await Deno.writeTextFile(userPath, content);
        console.log(`Copied to: ${userPath}`);
        const code = await openInEditor(userPath);
        return { code };
      }
    }

    case "delete": {
      const name = rest[0] ?? asString(a.flags.name);
      if (!name) {
        console.error("presets delete: missing <name>");
        usage();
        return { code: 2 };
      }

      const userDir = userPresetsDir();
      const userPath = pathJoin(userDir, `${name}.json`);

      try {
        await Deno.stat(userPath);
      } catch {
        throw new Error(
          `Preset not found in user directory: ${userPath}\n` +
            `Note: Only user-created presets can be deleted.`
        );
      }

      await Deno.remove(userPath);
      console.log(`Deleted preset: ${userPath}`);
      return { code: 0 };
    }

    default:
      usage();
      return { code: 2 };
  }
};
