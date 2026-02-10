import { sha256Hex } from "./hash.ts";
import { pathJoin } from "./os.ts";
import { validateWorktreeName } from "./validate.ts";

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
  const safeName = validateWorktreeName(worktreeName);
  const id = await repoIdForRoot(repoRoot);
  return pathJoin(baseDir, "worktrees", id, safeName);
};

export const macboxDir = (worktreePath: string) =>
  pathJoin(worktreePath, ".macbox");

export const macboxHome = (worktreePath: string) =>
  pathJoin(macboxDir(worktreePath), "home");
export const macboxCache = (worktreePath: string) =>
  pathJoin(macboxDir(worktreePath), "cache");
export const macboxTmp = (worktreePath: string) =>
  pathJoin(macboxDir(worktreePath), "tmp");
export const macboxLogs = (worktreePath: string) =>
  pathJoin(macboxDir(worktreePath), "logs");
export const macboxProfile = (worktreePath: string) =>
  pathJoin(macboxDir(worktreePath), "profile.sb");

export const sessionsDir = (baseDir: string) => pathJoin(baseDir, "sessions");
export const sessionDirForRepo = async (baseDir: string, repoRoot: string) => {
  const id = await repoIdForRoot(repoRoot);
  return pathJoin(baseDir, "sessions", id);
};
export const sessionFileFor = async (
  baseDir: string,
  repoRoot: string,
  worktreeName: string,
) => {
  const safeName = validateWorktreeName(worktreeName);
  const dir = await sessionDirForRepo(baseDir, repoRoot);
  return pathJoin(dir, `${safeName}.json`);
};

// --- Config directory (user config, not state) ---

export const configDir = () => {
  const home = Deno.env.get("HOME") ?? "";
  return pathJoin(home, ".config", "macbox");
};

export const projectRegistryPath = () => pathJoin(configDir(), "projects.json");

// --- Workspace paths ---

export const workspacesDir = (baseDir: string) =>
  pathJoin(baseDir, "workspaces");

export const workspaceDirForProject = (baseDir: string, projectId: string) =>
  pathJoin(baseDir, "workspaces", projectId);

export const workspaceFileFor = (
  baseDir: string,
  projectId: string,
  workspaceId: string,
) => pathJoin(baseDir, "workspaces", projectId, `${workspaceId}.json`);

// --- Flow result paths ---

export const flowResultsDir = (worktreePath: string) =>
  pathJoin(macboxDir(worktreePath), "flows");
