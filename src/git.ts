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
  // If worktreePath already exists and is a worktree, do nothing.
  // Otherwise, create a new worktree.
  const existing = await mustExec(["bash", "-lc", `test -d "${worktreePath}" && echo yes || echo no`], { quiet: true });
  if (existing.trim() === "yes") {
    // Try a lightweight check: does `.git` exist?
    const hasGitFile = await mustExec(["bash", "-lc", `test -e "${worktreePath}/.git" && echo yes || echo no`], { quiet: true });
    if (hasGitFile.trim() === "yes") return;
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
