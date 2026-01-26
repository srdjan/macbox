import { ensureDir, ensureGitignoreInmacbox, writeText } from "./fs.ts";
import { listSkills, type SkillRef } from "./skills.ts";
import { pathJoin } from "./os.ts";
import { skillsContractV1 } from "./skills_contract.ts";

export type SkillsRegistryV1 = {
  readonly schema: "macbox.skills.registry.v1";
  readonly generatedAt: string;
  readonly contract: typeof skillsContractV1;
  readonly skills: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly scope: "local" | "worktree";
    /** Skill directory relative to worktree (portable). */
    readonly dir: string;
    readonly manifest: {
      readonly command: ReadonlyArray<string>;
      readonly cwd?: string;
      readonly envKeys: ReadonlyArray<string>;
    };
  }>;
};

const rel = (worktreePath: string, absPath: string): string => {
  if (absPath === worktreePath) return ".";
  return absPath.startsWith(worktreePath + "/")
    ? absPath.slice(worktreePath.length + 1)
    : absPath;
};

const toEntry = (
  worktreePath: string,
  s: SkillRef,
): SkillsRegistryV1["skills"][number] => ({
  name: s.name,
  description: s.manifest.description,
  scope: s.scope,
  dir: rel(worktreePath, s.dir),
  manifest: {
    command: s.manifest.command,
    cwd: s.manifest.cwd,
    envKeys: Object.keys(s.manifest.env ?? {}).sort(),
  },
});

export const buildSkillsRegistry = async (
  worktreePath: string,
): Promise<SkillsRegistryV1> => {
  const skills = await listSkills(worktreePath);
  return {
    schema: "macbox.skills.registry.v1",
    generatedAt: new Date().toISOString(),
    contract: skillsContractV1,
    skills: skills.map((s) => toEntry(worktreePath, s)),
  };
};

export const registryDefaultPaths = (worktreePath: string) => {
  const local = pathJoin(worktreePath, ".macbox", "skills", "registry.json");
  const committed = pathJoin(worktreePath, "skills", "registry.json");
  return { local, committed };
};

export const writeSkillsRegistry = async (
  worktreePath: string,
  destPath: string,
  r: SkillsRegistryV1,
): Promise<void> => {
  // Ensure parent dir
  const parent = destPath.split("/").slice(0, -1).join("/") || ".";
  await ensureDir(parent);
  // If writing under .macbox, ensure it stays gitignored.
  if (destPath.includes("/.macbox/")) {
    await ensureGitignoreInmacbox(worktreePath);
  }
  await writeText(destPath, JSON.stringify(r, null, 2) + "\n");
};
