import { pathJoin } from "./os.ts";
import { ensureDir } from "./fs.ts";
import type { AgentKind } from "./agent.ts";

export type PresetCapabilities = {
  readonly network?: boolean;
  readonly exec?: boolean;
  readonly extraReadPaths?: ReadonlyArray<string>;
  readonly extraWritePaths?: ReadonlyArray<string>;
};

export type PresetRalphConfig = {
  readonly maxIterations?: number;
  readonly qualityGates?: ReadonlyArray<{ readonly name: string; readonly cmd: string; readonly continueOnFail?: boolean }>;
  readonly delayBetweenIterationsMs?: number;
  readonly commitOnPass?: boolean;
  readonly promptTemplate?: string;
};

export type Preset = {
  readonly name: string;
  readonly description?: string;
  readonly agent?: AgentKind;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly cmd?: string;
  readonly profiles?: ReadonlyArray<string>;
  readonly capabilities?: PresetCapabilities;
  readonly env?: Readonly<Record<string, string>>;
  readonly worktreePrefix?: string;
  readonly startPoint?: string;
  readonly ralph?: PresetRalphConfig;
  readonly skills?: ReadonlyArray<string>;
};

export type LoadedPreset = {
  readonly preset: Preset;
  readonly source: string;
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

const validatePreset = (raw: unknown, nameHint: string): Preset => {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`Preset '${nameHint}': expected JSON object`);
  }
  const o = raw as Record<string, unknown>;

  const name =
    typeof o.name === "string" && o.name.trim() ? o.name.trim() : nameHint;
  const description =
    typeof o.description === "string" ? o.description : undefined;
  const agent = isValidAgent(o.agent) ? o.agent : undefined;
  const model = typeof o.model === "string" ? o.model : undefined;
  const apiKeyEnv = typeof o.apiKeyEnv === "string" ? o.apiKeyEnv : undefined;
  const cmd = typeof o.cmd === "string" ? o.cmd : undefined;

  const profiles = Array.isArray(o.profiles)
    ? (o.profiles.filter((x) => typeof x === "string") as string[])
    : undefined;

  const capabilities = (() => {
    if (o.capabilities === null || typeof o.capabilities !== "object") {
      return undefined;
    }
    const c = o.capabilities as Record<string, unknown>;
    return {
      network: typeof c.network === "boolean" ? c.network : undefined,
      exec: typeof c.exec === "boolean" ? c.exec : undefined,
      extraReadPaths: Array.isArray(c.extraReadPaths)
        ? (c.extraReadPaths.filter((x) => typeof x === "string") as string[])
        : undefined,
      extraWritePaths: Array.isArray(c.extraWritePaths)
        ? (c.extraWritePaths.filter((x) => typeof x === "string") as string[])
        : undefined,
    } as PresetCapabilities;
  })();

  const env = (() => {
    if (o.env === null || typeof o.env !== "object") return undefined;
    const e = o.env as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  })();

  const worktreePrefix =
    typeof o.worktreePrefix === "string" ? o.worktreePrefix : undefined;
  const startPoint =
    typeof o.startPoint === "string" ? o.startPoint : undefined;

  const ralph = (() => {
    if (o.ralph === null || typeof o.ralph !== "object") return undefined;
    const r = o.ralph as Record<string, unknown>;
    const gates = Array.isArray(r.qualityGates)
      ? (r.qualityGates as unknown[]).filter(
          (g): g is Record<string, unknown> =>
            !!g && typeof g === "object" && typeof (g as Record<string, unknown>).name === "string" && typeof (g as Record<string, unknown>).cmd === "string",
        ).map((g) => ({
          name: g.name as string,
          cmd: g.cmd as string,
          continueOnFail: typeof g.continueOnFail === "boolean" ? g.continueOnFail : undefined,
        }))
      : undefined;
    return {
      maxIterations: typeof r.maxIterations === "number" ? r.maxIterations : undefined,
      qualityGates: gates,
      delayBetweenIterationsMs: typeof r.delayBetweenIterationsMs === "number" ? r.delayBetweenIterationsMs : undefined,
      commitOnPass: typeof r.commitOnPass === "boolean" ? r.commitOnPass : undefined,
      promptTemplate: typeof r.promptTemplate === "string" ? r.promptTemplate : undefined,
    } as PresetRalphConfig;
  })();

  const skills = Array.isArray(o.skills)
    ? (o.skills.filter((x) => typeof x === "string") as string[])
    : undefined;

  return {
    name,
    description,
    agent,
    model,
    apiKeyEnv,
    cmd,
    profiles,
    capabilities,
    env,
    worktreePrefix,
    startPoint,
    ralph,
    skills,
  };
};

export const resolvePresetFile = (nameOrPath: string): ReadonlyArray<string> => {
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
      const preset = validatePreset(raw, nameOrPath);
      return { preset, source: p };
    }
  }
  throw new Error(
    `Preset not found: ${nameOrPath} (searched: ${candidates.join(", ")})`
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

export const listAvailablePresets = async (): Promise<ReadonlyArray<string>> => {
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
  preset: Preset
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

export const writeAgentConfig = async (
  worktree: string,
  agent: AgentKind,
  model: string
): Promise<void> => {
  const home = `${worktree}/.macbox/home`;

  if (agent === "claude") {
    const configDir = `${home}/.claude`;
    await ensureDir(configDir);
    const config = { model };
    await Deno.writeTextFile(
      `${configDir}/settings.json`,
      JSON.stringify(config, null, 2) + "\n"
    );
  } else if (agent === "codex") {
    const configDir = `${home}/.codex`;
    await ensureDir(configDir);
    const config = { model };
    await Deno.writeTextFile(
      `${configDir}/config.json`,
      JSON.stringify(config, null, 2) + "\n"
    );
  }
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

type SkillFrontmatter = {
  readonly name: string;
  readonly description: string;
};

const parseFrontmatter = (content: string): SkillFrontmatter | null => {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) return null;

  let name = "";
  let description = "";
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key === "name") name = val;
    else if (key === "description") description = val;
  }

  if (!name) return null;
  return { name, description };
};

const skillNameFromPath = (p: string): string => {
  const base = p.split("/").pop() ?? "";
  return base.replace(/\.md$/i, "").toLowerCase();
};

export const writeSkillFiles = async (
  worktree: string,
  skillPaths: ReadonlyArray<string>,
): Promise<void> => {
  const skillsDir = `${worktree}/.macbox/home/.claude/skills`;
  await ensureDir(skillsDir);

  const entries: Array<{ name: string; description: string; path: string }> = [];

  for (const sp of skillPaths) {
    let content: string;
    try {
      content = await Deno.readTextFile(sp);
    } catch {
      console.error(`macbox: WARNING: skill file not found: ${sp}`);
      continue;
    }

    const fm = parseFrontmatter(content);
    const name = fm?.name ?? skillNameFromPath(sp);
    const description = fm?.description ?? "";
    const destPath = `${skillsDir}/${name}.md`;
    await Deno.writeTextFile(destPath, content, { create: true });
    entries.push({ name, description, path: `~/.claude/skills/${name}.md` });
  }

  if (entries.length === 0) return;

  const rows = entries
    .map((e) => `| ${e.name} | ${e.description} | ${e.path} |`)
    .join("\n");

  const claudeMd = `# Available Skills

Select the skill that matches your current task based on the descriptions below.
To use a skill, read the full file at the listed path.

| Skill | Description | Path |
|-------|-------------|------|
${rows}
`;

  const claudeMdPath = `${worktree}/.macbox/home/.claude/CLAUDE.md`;
  await Deno.writeTextFile(claudeMdPath, claudeMd, { create: true });
};
