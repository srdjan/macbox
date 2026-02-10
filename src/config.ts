import { pathJoin } from "./os.ts";
import type { AgentKind } from "./agent.ts";

export type MacboxConfig = {
  readonly schema: "macbox.config.v1";
  readonly defaults?: {
    readonly agent?: AgentKind;
    readonly preset?: string;
    readonly profiles?: ReadonlyArray<string>;
  };
};

export type LoadedMacboxConfig = {
  readonly config: MacboxConfig;
  readonly warnings: ReadonlyArray<string>;
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

const allowedRootKeys = new Set(["schema", "defaults"]);
const allowedDefaultsKeys = new Set(["agent", "preset", "profiles"]);

const isAgentKind = (v: unknown): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

const validateConfig = (raw: unknown): LoadedMacboxConfig => {
  if (!isObj(raw)) {
    throw new Error("macbox.json: expected an object at root");
  }
  const warnings: string[] = [];

  for (const k of Object.keys(raw)) {
    if (!allowedRootKeys.has(k)) {
      warnings.push(`macbox.json: unknown top-level field '${k}' is ignored`);
    }
  }

  if (typeof raw.schema === "string" && raw.schema !== "macbox.config.v1") {
    warnings.push(
      `macbox.json: unsupported schema '${raw.schema}'. Expected 'macbox.config.v1'`,
    );
  }

  const defaults = isObj(raw.defaults)
    ? (() => {
      const d = raw.defaults as Record<string, unknown>;
      for (const k of Object.keys(d)) {
        if (!allowedDefaultsKeys.has(k)) {
          warnings.push(
            `macbox.json.defaults: unknown field '${k}' is ignored`,
          );
        }
      }

      const agent = (() => {
        if (d.agent === undefined) return undefined;
        if (!isAgentKind(d.agent)) {
          warnings.push(
            `macbox.json.defaults.agent: expected one of claude|codex|custom, got '${
              String(d.agent)
            }'`,
          );
          return undefined;
        }
        return d.agent;
      })();

      const preset = typeof d.preset === "string"
        ? d.preset
        : d.preset === undefined
        ? undefined
        : (warnings.push("macbox.json.defaults.preset: expected string"),
          undefined);

      const profiles = Array.isArray(d.profiles)
        ? (d.profiles.filter((p) => typeof p === "string") as string[])
        : d.profiles === undefined
        ? undefined
        : (warnings.push("macbox.json.defaults.profiles: expected string[]"),
          undefined);

      return { agent, preset, profiles };
    })()
    : undefined;

  return {
    config: {
      schema: "macbox.config.v1",
      defaults,
    },
    warnings,
  };
};

export const loadMacboxConfigWithWarnings = async (
  _repoRoot: string,
  cwd: string,
): Promise<LoadedMacboxConfig | null> => {
  const configPath = pathJoin(cwd, "macbox.json");
  try {
    const text = await Deno.readTextFile(configPath);
    const raw = JSON.parse(text);
    return validateConfig(raw);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to load macbox.json: ${msg}`);
  }
};

export const loadMacboxConfig = async (
  repoRoot: string,
  cwd: string,
): Promise<MacboxConfig | null> => {
  const loaded = await loadMacboxConfigWithWarnings(repoRoot, cwd);
  return loaded?.config ?? null;
};
