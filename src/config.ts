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

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

const validateConfig = (raw: unknown): MacboxConfig => {
  if (!isObj(raw)) {
    throw new Error("macbox.json: expected an object at root");
  }

  const defaults = isObj(raw.defaults)
    ? {
        agent: typeof (raw.defaults as Record<string, unknown>).agent === "string"
          ? (raw.defaults as Record<string, unknown>).agent as AgentKind
          : undefined,
        preset: typeof (raw.defaults as Record<string, unknown>).preset === "string"
          ? (raw.defaults as Record<string, unknown>).preset as string
          : undefined,
        profiles: Array.isArray((raw.defaults as Record<string, unknown>).profiles)
          ? ((raw.defaults as Record<string, unknown>).profiles as unknown[]).filter((p) =>
              typeof p === "string"
            ) as string[]
          : undefined,
      }
    : undefined;

  return {
    schema: "macbox.config.v1",
    defaults,
  };
};

export const loadMacboxConfig = async (
  _repoRoot: string,
  cwd: string,
): Promise<MacboxConfig | null> => {
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
