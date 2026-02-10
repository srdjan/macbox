import { mustExec } from "./exec.ts";

export type RepoInfo = {
  readonly root: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly branch: string;
};

export const detectRepo = async (repoHint?: string): Promise<RepoInfo> => {
  const root = await mustExec(["git", "rev-parse", "--show-toplevel"], { cwd: repoHint, label: "git repo root" });
  const gitCommonDir = await mustExec(["git", "rev-parse", "--git-common-dir"], { cwd: root, label: "git-common-dir" });
  const gitDir = await mustExec(["git", "rev-parse", "--git-dir"], { cwd: root, label: "git-dir" });
  const branch = await mustExec(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, label: "git branch" });

  // rev-parse can return relative paths for git dirs; normalize to absolute
  const abs = (p: string) => p.startsWith("/") ? p : `${root}/${p}`.replaceAll("//", "/");
  return {
    root,
    gitCommonDir: abs(gitCommonDir),
    gitDir: abs(gitDir),
    branch,
  };
};

export const ensureWorktree = async (
  root: string,
  worktreePath: string,
  worktreeBranch: string,
  startPoint: string = "HEAD",
) => {
  const absFrom = (base: string, p: string) =>
    p.startsWith("/") ? p : `${base}/${p}`.replaceAll("//", "/");

  const rootGitCommonDir = absFrom(
    root,
    await mustExec(["git", "rev-parse", "--git-common-dir"], { cwd: root, label: "git-common-dir" }),
  );

  // If worktreePath already exists and belongs to this repo, do nothing.
  try {
    const st = await Deno.stat(worktreePath);
    if (!st.isDirectory) {
      throw new Error(`worktree path exists but is not a directory: ${worktreePath}`);
    }
    const wtGitCommonDirRaw = await mustExec([
      "git",
      "-C",
      worktreePath,
      "rev-parse",
      "--git-common-dir",
    ], { quiet: true });
    const wtGitCommonDir = absFrom(worktreePath, wtGitCommonDirRaw);
    if (wtGitCommonDir === rootGitCommonDir) {
      return;
    }
    throw new Error(
      `worktree path already exists and belongs to a different repository: ${worktreePath}`,
    );
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("belongs to a different repository") || msg.includes("is not a directory")) {
        throw new Error(`macbox: ${msg}`);
      }
    }
  }

  await mustExec(["mkdir", "-p", worktreePath], { quiet: true });
  // Create (or reset) the worktree branch at the chosen start point.
  // We keep it simple: `git worktree add <path> -B <branch> <start-point>`
  await mustExec(["git", "worktree", "add", worktreePath, "-B", worktreeBranch, startPoint], { cwd: root, label: "git worktree add" });
};

export const removeWorktree = async (root: string, worktreePath: string) => {
  // Use git to remove so it cleans up metadata.
  await mustExec(["git", "worktree", "remove", "--force", worktreePath], { cwd: root, label: "git worktree remove" });
};
