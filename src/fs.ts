import { mustExec } from "./exec.ts";

export const ensureDir = async (p: string) => {
  await mustExec(["mkdir", "-p", p], { quiet: true });
};

export const writeText = async (p: string, s: string) => {
  await Deno.writeTextFile(p, s, { create: true });
};

export const atomicWriteJson = async (filePath: string, obj: unknown) => {
  const dir = filePath.split("/").slice(0, -1).join("/") || ".";
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(obj, null, 2) + "\n", { create: true });
  await Deno.rename(tmp, filePath);
};

export const ensureGitignoreInmacbox = async (worktreePath: string) => {
  const gi = `${worktreePath}/.macbox/.gitignore`;
  try {
    await Deno.stat(gi);
  } catch {
    await writeText(gi, "*\n");
  }
};
