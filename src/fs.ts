import { mustExec } from "./exec.ts";

export const ensureDir = async (p: string) => {
  await mustExec(["mkdir", "-p", p], { quiet: true });
};

export const writeText = async (p: string, s: string) => {
  await Deno.writeTextFile(p, s, { create: true });
};

export const ensureGitignoreInmacbox = async (worktreePath: string) => {
  const gi = `${worktreePath}/.macbox/.gitignore`;
  try {
    await Deno.stat(gi);
  } catch {
    await writeText(gi, "*\n");
  }
};
