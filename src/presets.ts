import { pathJoin } from "./os.ts";
import type { AgentKind } from "./agent.ts";

export type PresetCapabilities = {
  readonly network?: boolean;
  readonly exec?: boolean;
  readonly extraReadPaths?: ReadonlyArray<string>;
  readonly extraWritePaths?: ReadonlyArray<string>;
};

export type Preset = {
  readonly name: string;
  readonly description?: string;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly capabilities?: PresetCapabilities;
  readonly env?: Readonly<Record<string, string>>;
  readonly worktreePrefix?: string;
  readonly startPoint?: string;
};

export type LoadedPreset = {
  readonly preset: Preset;
  readonly source: string;
  readonly warnings: ReadonlyArray<string>;
};

const normalizePath = (p: string): string => {
  const abs = p.startsWith("/");
  const parts = p.split("/").filter((x) => x.length > 0 && x !== ".");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = (abs ? "/" : "") + out.join("/");
  return joined === "" ? (abs ? "/" : ".") : joined;
};

const expandTilde = (p: string): string => {
  if (p === "~" || p.startsWith("~/")) {
    const home = Deno.env.get("HOME") ?? "";
    return home ? pathJoin(home, p.slice(2)) : p;
  }
  return p;
};

export const expandPath = (p: string): string => normalizePath(expandTilde(p));

export const userPresetsDir = (): string => {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  const home = Deno.env.get("HOME") ?? "";
  const base = xdg ?? (home ? pathJoin(home, ".config") : ".");
  return pathJoin(base, "macbox", "presets");
};

const envPresetsDir = (): string | null => {
  const raw = Deno.env.get("MACBOX_PRESETS_DIR");
  if (!raw) return null;
  const p = raw.trim();
  if (!p) return null;
  if (p.startsWith("/")) return normalizePath(p);
  return normalizePath(pathJoin(Deno.cwd(), p));
};

const dirExists = (p: string): boolean => {
  try {
    const st = Deno.statSync(p);
    return st.isDirectory;
  } catch {
    return false;
  }
};

export const bundledPresetsDir = (): string => {
  const candidates: string[] = [];
  try {
    const execPath = Deno.execPath();
    const cut = execPath.lastIndexOf("/");
    if (cut > 0) {
      const execDir = execPath.slice(0, cut);
      candidates.push(pathJoin(execDir, "presets"));
      candidates.push(pathJoin(execDir, "..", "share", "macbox", "presets"));
    }
  } catch {
    // ignore
  }

  const u = new URL("../presets/", import.meta.url);
  const repoDir = decodeURIComponent(u.pathname.replace(/\/$/, ""));
  candidates.push(repoDir);

  for (const c of candidates) {
    if (dirExists(c)) return c;
  }
  return repoDir;
};

const tryReadJsonFile = async (path: string): Promise<unknown | null> => {
  try {
    const txt = await Deno.readTextFile(path);
    return JSON.parse(txt);
  } catch {
    return null;
  }
};

const isPathLike = (name: string) =>
  name.includes("/") || name.endsWith(".json") || name.startsWith(".");

const isValidAgent = (v: unknown): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

const allowedPresetKeys = new Set([
  "name",
  "description",
  "agent",
  "profiles",
  "capabilities",
  "env",
  "worktreePrefix",
  "startPoint",
]);
const legacyPresetKeys = new Set([
  "model",
  "apiKeyEnv",
  "cmd",
  "skills",
  "ralph",
]);
const allowedCapabilitiesKeys = new Set([
  "network",
  "exec",
  "extraReadPaths",
  "extraWritePaths",
]);

type ValidatedPreset = {
  readonly preset: Preset;
  readonly warnings: ReadonlyArray<string>;
};

const validatePreset = (raw: unknown, nameHint: string): ValidatedPreset => {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`Preset '${nameHint}': expected JSON object`);
  }
  const o = raw as Record<string, unknown>;
  const warnings: string[] = [];

  for (const k of Object.keys(o)) {
    if (legacyPresetKeys.has(k)) {
      warnings.push(
        `Preset '${nameHint}': legacy field '${k}' is ignored in v2`,
      );
      continue;
    }
    if (!allowedPresetKeys.has(k)) {
      warnings.push(`Preset '${nameHint}': unknown field '${k}' is ignored`);
    }
  }

  const name = typeof o.name === "string" && o.name.trim()
    ? o.name.trim()
    : nameHint;
  const description = typeof o.description === "string"
    ? o.description
    : undefined;
  const agent = (() => {
    if (o.agent === undefined) return undefined;
    if (!isValidAgent(o.agent)) {
      warnings.push(
        `Preset '${nameHint}': invalid agent '${
          String(o.agent)
        }' (expected claude|codex|custom)`,
      );
      return undefined;
    }
    return o.agent;
  })();

  const profiles = Array.isArray(o.profiles)
    ? (o.profiles.filter((x) => typeof x === "string") as string[])
    : undefined;

  const capabilities = (() => {
    if (o.capabilities === null || typeof o.capabilities !== "object") {
      if (o.capabilities !== undefined) {
        warnings.push(`Preset '${nameHint}': capabilities must be an object`);
      }
      return undefined;
    }
    const c = o.capabilities as Record<string, unknown>;
    for (const k of Object.keys(c)) {
      if (!allowedCapabilitiesKeys.has(k)) {
        warnings.push(
          `Preset '${nameHint}': capabilities.${k} is not supported and will be ignored`,
        );
      }
    }
    return {
      network: typeof c.network === "boolean"
        ? c.network
        : c.network === undefined
        ? undefined
        : (warnings.push(
          `Preset '${nameHint}': capabilities.network must be boolean`,
        ),
          undefined),
      exec: typeof c.exec === "boolean"
        ? c.exec
        : c.exec === undefined
        ? undefined
        : (warnings.push(
          `Preset '${nameHint}': capabilities.exec must be boolean`,
        ),
          undefined),
      extraReadPaths: Array.isArray(c.extraReadPaths)
        ? (c.extraReadPaths.filter((x) => typeof x === "string") as string[])
        : c.extraReadPaths === undefined
        ? undefined
        : (warnings.push(
          `Preset '${nameHint}': capabilities.extraReadPaths must be string[]`,
        ),
          undefined),
      extraWritePaths: Array.isArray(c.extraWritePaths)
        ? (c.extraWritePaths.filter((x) => typeof x === "string") as string[])
        : c.extraWritePaths === undefined
        ? undefined
        : (warnings.push(
          `Preset '${nameHint}': capabilities.extraWritePaths must be string[]`,
        ),
          undefined),
    } as PresetCapabilities;
  })();

  const env = (() => {
    if (o.env === null || typeof o.env !== "object") {
      if (o.env !== undefined) {
        warnings.push(`Preset '${nameHint}': env must be an object`);
      }
      return undefined;
    }
    const e = o.env as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === "string") {
        out[k] = v;
      } else {
        warnings.push(`Preset '${nameHint}': env.${k} must be a string`);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  })();

  const worktreePrefix = typeof o.worktreePrefix === "string"
    ? o.worktreePrefix
    : o.worktreePrefix === undefined
    ? undefined
    : (warnings.push(`Preset '${nameHint}': worktreePrefix must be a string`),
      undefined);
  const startPoint = typeof o.startPoint === "string"
    ? o.startPoint
    : o.startPoint === undefined
    ? undefined
    : (warnings.push(`Preset '${nameHint}': startPoint must be a string`),
      undefined);

  return {
    preset: {
      name,
      description,
      agent,
      profiles,
      capabilities,
      env,
      worktreePrefix,
      startPoint,
    },
    warnings,
  };
};

export const validatePresetWithWarnings = (
  raw: unknown,
  nameHint: string,
): ValidatedPreset => validatePreset(raw, nameHint);

export const validatePresetOnly = (raw: unknown, nameHint: string): Preset =>
  validatePreset(raw, nameHint).preset;

export const resolvePresetFile = (
  nameOrPath: string,
): ReadonlyArray<string> => {
  if (isPathLike(nameOrPath)) {
    const p = nameOrPath.startsWith("/")
      ? nameOrPath
      : pathJoin(Deno.cwd(), nameOrPath);
    return [normalizePath(p)];
  }
  const name = nameOrPath;
  const envDir = envPresetsDir();
  return [
    ...(envDir ? [pathJoin(envDir, `${name}.json`)] : []),
    pathJoin(userPresetsDir(), `${name}.json`),
    pathJoin(bundledPresetsDir(), `${name}.json`),
  ];
};

export const loadPreset = async (nameOrPath: string): Promise<LoadedPreset> => {
  const candidates = resolvePresetFile(nameOrPath);
  for (const p of candidates) {
    const raw = await tryReadJsonFile(p);
    if (raw !== null) {
      const validated = validatePreset(raw, nameOrPath);
      return {
        preset: validated.preset,
        source: p,
        warnings: validated.warnings,
      };
    }
  }
  throw new Error(
    `Preset not found: ${nameOrPath} (searched: ${candidates.join(", ")})`,
  );
};

const listJsonNames = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile) continue;
      if (!e.name.endsWith(".json")) continue;
      out.push(e.name.slice(0, -".json".length));
    }
  } catch {
    // ignore
  }
  return out;
};

export const listAvailablePresets = async (): Promise<
  ReadonlyArray<string>
> => {
  const names = new Set<string>();
  const envDir = envPresetsDir();
  if (envDir) {
    for (const n of await listJsonNames(envDir)) names.add(n);
  }
  for (const n of await listJsonNames(bundledPresetsDir())) names.add(n);
  for (const n of await listJsonNames(userPresetsDir())) names.add(n);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
};

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

export const validatePresetPaths = async (
  preset: Preset,
): Promise<ReadonlyArray<string>> => {
  const warnings: string[] = [];

  for (const p of preset.capabilities?.extraReadPaths ?? []) {
    const expanded = expandPath(p);
    if (!(await pathExists(expanded))) {
      warnings.push(`Read path does not exist: ${p}`);
    }
  }

  for (const p of preset.capabilities?.extraWritePaths ?? []) {
    const expanded = expandPath(p);
    if (!(await pathExists(expanded))) {
      warnings.push(`Write path does not exist: ${p}`);
    }
  }

  return warnings;
};

export const defaultPresetTemplate = (name: string): Preset => ({
  name,
  description: "",
  agent: "claude",
  profiles: [],
  capabilities: {
    network: true,
    exec: true,
    extraReadPaths: [],
    extraWritePaths: [],
  },
  env: {},
  worktreePrefix: `ai-${name}`,
  startPoint: "main",
});
