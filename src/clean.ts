import { parseArgs } from "./mini_args.ts";
import { detectRepo, removeWorktree } from "./git.ts";
import { defaultBaseDir, repoIdForRoot, worktreeDir } from "./paths.ts";
import { mustExec } from "./exec.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === "string" ? v : v ? "true" : "false";

export const cleanCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const repoHint = asString(a.flags.repo);
  const base = asString(a.flags.base) ?? defaultBaseDir();

  const all = a.flags.all === true || a.flags.all === "true";
  const worktreeName = asString(a.flags.worktree);

  const repo = await detectRepo(repoHint);
  const repoId = await repoIdForRoot(repo.root);

  if (all) {
    // Remove all worktrees under this repoId
    const dir = `${base}/worktrees/${repoId}`;
    // Enumerate directories
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isDirectory) continue;
        const wtPath = `${dir}/${e.name}`;
        await removeWorktree(repo.root, wtPath).catch(() => undefined);
      }
      await mustExec(["rm", "-rf", dir], { quiet: true });
    } catch {
      // nothing to do
    }
    return { code: 0 };
  }

  if (!worktreeName) {
    throw new Error("clean: specify --worktree <name> or --all");
  }
  const wtPath = await worktreeDir(base, repo.root, worktreeName);
  await removeWorktree(repo.root, wtPath);
  return { code: 0 };
};
