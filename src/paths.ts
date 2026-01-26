import { sha256Hex } from "./hash.ts";
import { pathJoin } from "./os.ts";

export type BasePaths = {
  readonly baseDir: string;
  readonly worktreesDir: string;
  readonly sessionsDir: string;
};

export const defaultBaseDir = () => {
  const home = Deno.env.get("HOME") ?? "";
  return pathJoin(home, ".local", "share", "macbox");
};

export const basePaths = (baseDir: string): BasePaths => ({
  baseDir,
  worktreesDir: pathJoin(baseDir, "worktrees"),
  sessionsDir: pathJoin(baseDir, "sessions"),
});

export const repoIdForRoot = async (repoRoot: string): Promise<string> =>
  (await sha256Hex(repoRoot)).slice(0, 12);

export const worktreeDir = async (
  baseDir: string,
  repoRoot: string,
  worktreeName: string,
): Promise<string> => {
  const id = await repoIdForRoot(repoRoot);
  return pathJoin(baseDir, "worktrees", id, worktreeName);
};

export const macboxDir = (worktreePath: string) => pathJoin(worktreePath, ".macbox");

export const macboxHome = (worktreePath: string) => pathJoin(macboxDir(worktreePath), "home");
export const macboxCache = (worktreePath: string) => pathJoin(macboxDir(worktreePath), "cache");
export const macboxTmp = (worktreePath: string) => pathJoin(macboxDir(worktreePath), "tmp");
export const macboxLogs = (worktreePath: string) => pathJoin(macboxDir(worktreePath), "logs");
export const macboxProfile = (worktreePath: string) => pathJoin(macboxDir(worktreePath), "profile.sb");


export const sessionsDir = (baseDir: string) => pathJoin(baseDir, "sessions");
export const sessionDirForRepo = async (baseDir: string, repoRoot: string) => {
  const id = await repoIdForRoot(repoRoot);
  return pathJoin(baseDir, "sessions", id);
};
export const sessionFileFor = async (baseDir: string, repoRoot: string, worktreeName: string) => {
  const dir = await sessionDirForRepo(baseDir, repoRoot);
  return pathJoin(dir, `${worktreeName}.json`);
};
