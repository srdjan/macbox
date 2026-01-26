import { ensureDir, ensureGitignoreInmacbox, writeText } from "./fs.ts";
import { pathJoin } from "./os.ts";

export type SkillManifest = {
  readonly name: string;
  readonly description?: string;
  /** Command argv to execute. */
  readonly command: ReadonlyArray<string>;
  /**
   * Optional working directory.
   * If relative, it is resolved against the skill directory.
   */
  readonly cwd?: string;
  /** Extra environment variables for the command. Values may include ${WORKTREE} and ${SKILL_DIR}. */
  readonly env?: Record<string, string>;
};

export type SkillScope = "worktree" | "local";

export type SkillRef = {
  readonly name: string;
  readonly scope: SkillScope;
  readonly dir: string;
  readonly manifest: SkillManifest;
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object";

const readJson = async (p: string): Promise<unknown> => {
  const txt = await Deno.readTextFile(p);
  return JSON.parse(txt);
};

const validateManifest = (raw: unknown, path: string): SkillManifest => {
  if (!isObj(raw)) throw new Error(`skill.json: expected object: ${path}`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) throw new Error(`skill.json: missing 'name': ${path}`);
  const description = typeof raw.description === "string"
    ? raw.description
    : undefined;
  const command = Array.isArray(raw.command)
    ? raw.command.filter((x) => typeof x === "string") as string[]
    : [];
  if (command.length === 0) {
    throw new Error(`skill.json: missing 'command' (string[]): ${path}`);
  }
  const cwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
  const env = (() => {
    const e = raw.env;
    if (!isObj(e)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  })();
  return { name, description, command, cwd, env };
};

export const skillsRoots = (worktreePath: string) => {
  const committed = pathJoin(worktreePath, "skills");
  const local = pathJoin(worktreePath, ".macbox", "skills");
  return { committed, local };
};

const listSkillDirs = async (root: string): Promise<ReadonlyArray<string>> => {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(root)) {
      if (!e.isDirectory) continue;
      out.push(pathJoin(root, e.name));
    }
  } catch {
    // ignore missing root
  }
  return out;
};

const tryLoadSkill = async (
  scope: SkillScope,
  dir: string,
): Promise<SkillRef | null> => {
  const manifestPath = pathJoin(dir, "skill.json");
  try {
    const raw = await readJson(manifestPath);
    const manifest = validateManifest(raw, manifestPath);
    return { name: manifest.name, scope, dir, manifest };
  } catch {
    return null;
  }
};

export const listSkills = async (
  worktreePath: string,
): Promise<ReadonlyArray<SkillRef>> => {
  const { committed, local } = skillsRoots(worktreePath);

  const xs: SkillRef[] = [];
  // Prefer local overrides (same name) over committed.
  const seen = new Set<string>();
  for (const d of await listSkillDirs(local)) {
    const s = await tryLoadSkill("local", d);
    if (!s) continue;
    xs.push(s);
    seen.add(s.name);
  }
  for (const d of await listSkillDirs(committed)) {
    const s = await tryLoadSkill("worktree", d);
    if (!s) continue;
    if (seen.has(s.name)) continue;
    xs.push(s);
  }
  return xs.sort((a, b) => a.name.localeCompare(b.name));
};

export const loadSkillByName = async (
  worktreePath: string,
  name: string,
): Promise<SkillRef> => {
  const xs = await listSkills(worktreePath);
  const hit = xs.find((s) => s.name === name);
  if (!hit) {
    const names = xs.map((s) => s.name).join(", ");
    throw new Error(
      `macbox: unknown skill '${name}'. Available: ${names || "(none)"}`,
    );
  }
  return hit;
};

export type InitSkillOptions = {
  readonly worktreePath: string;
  readonly name: string;
  readonly local: boolean;
};

export const initSkill = async (o: InitSkillOptions): Promise<SkillRef> => {
  const roots = skillsRoots(o.worktreePath);
  const root = o.local ? roots.local : roots.committed;
  const dir = pathJoin(root, o.name);
  await ensureDir(dir);
  if (o.local) {
    await ensureDir(pathJoin(o.worktreePath, ".macbox"));
    await ensureGitignoreInmacbox(o.worktreePath);
  }

  const manifestPath = pathJoin(dir, "skill.json");
  const runPath = pathJoin(dir, "run.ts");
  const readmePath = pathJoin(dir, "README.md");

  const manifest: SkillManifest = {
    name: o.name,
    description: "A macbox skill (runs inside the sandbox)",
    command: ["deno", "run", "-A", "./run.ts"],
    cwd: ".",
    env: {
      // Examples:
      // WORKTREE is injected automatically by macbox at runtime.
      EXAMPLE: "hello-from-${SKILL_DIR}",
    },
  };

  await writeText(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeText(
    runPath,
    [
      "// A minimal skill entrypoint.",
      "// It runs inside the macbox Seatbelt sandbox.",
      "",
      "console.log(JSON.stringify({",
      "  skill: Deno.env.get('MACBOX_SKILL') ?? 'unknown',",
      "  worktree: Deno.env.get('MACBOX_WORKTREE') ?? '',",
      "  args: Deno.args,",
      "}, null, 2));",
      "",
    ].join("\n"),
  );
  await writeText(
    readmePath,
    [
      `# ${o.name}
`,
      "This is a **macbox skill**. It executes **inside the same native macOS sandbox** as your agent.",
      "",
      "## Edit the manifest",
      "- `skill.json` defines the command/cwd/env",
      "- `run.ts` is the default entrypoint for this template",
      "",
      "Run it:",
      "",
      "```bash",
      `macbox skills run ${o.name} -- --help`,
      "```",
      "",
    ].join("\n"),
  );

  return await loadSkillByName(o.worktreePath, o.name);
};

const expand = (s: string, vars: Record<string, string>): string => {
  let out = s;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`\${${k}}`, v);
  }
  return out;
};

export const expandSkill = (
  skill: SkillRef,
  worktreePath: string,
): {
  readonly command: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Record<string, string>;
} => {
  const vars = {
    WORKTREE: worktreePath,
    SKILL_DIR: skill.dir,
  };

  const command = skill.manifest.command.map((x) => expand(x, vars));
  const cwdRel = skill.manifest.cwd;
  const cwd = cwdRel
    ? (cwdRel.startsWith("/") ? cwdRel : pathJoin(skill.dir, cwdRel))
    : skill.dir;

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(skill.manifest.env ?? {})) {
    env[k] = expand(v, vars);
  }

  return { command, cwd, env };
};
