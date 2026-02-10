import { parseArgs } from "./mini_args.ts";
import { detectRepo, removeWorktree } from "./git.ts";
import { defaultBaseDir, repoIdForRoot, worktreeDir } from "./paths.ts";
import { mustExec } from "./exec.ts";
import { boolFlag, requireStringFlag } from "./flags.ts";

const printCleanUsage = (json: boolean) => {
  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.clean.usage.v1",
        usage:
          "macbox clean [--json] [--worktree <name> | --all] [--repo <path>] [--base <path>]",
      },
      null,
      2,
    ));
    return;
  }
  console.log(
    "Usage:\n" +
      "  macbox clean --worktree <name> [--repo <path>] [--base <path>]\n" +
      "  macbox clean --all [--repo <path>] [--base <path>]",
  );
};

export const cleanCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const json = boolFlag(a.flags.json, false);
  if (a.flags.help) {
    printCleanUsage(json);
    return { code: 0 };
  }
  const repoHint = requireStringFlag("repo", a.flags.repo);
  const base = requireStringFlag("base", a.flags.base) ?? defaultBaseDir();

  const all = a.flags.all === true || a.flags.all === "true";
  const worktreeName = requireStringFlag("worktree", a.flags.worktree);

  if (!all && !worktreeName) {
    throw new Error(
      "clean: specify --worktree <name> or --all\n" +
        "  Use: macbox clean --help",
    );
  }

  const repo = await detectRepo(repoHint);
  const repoId = await repoIdForRoot(repo.root);

  if (all) {
    // Remove all worktrees under this repoId
    const dir = `${base}/worktrees/${repoId}`;
    const removed: string[] = [];
    // Enumerate directories
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isDirectory) continue;
        const wtPath = `${dir}/${e.name}`;
        await removeWorktree(repo.root, wtPath).catch(() => undefined);
        removed.push(e.name);
      }
      await mustExec(["rm", "-rf", dir], { quiet: true });
    } catch {
      // nothing to do
    }
    if (json) {
      console.log(JSON.stringify(
        {
          schema: "macbox.clean.v1",
          mode: "all",
          repoId,
          removedWorktrees: removed,
        },
        null,
        2,
      ));
    }
    return { code: 0 };
  }
  if (!worktreeName) {
    throw new Error("clean: internal error: missing worktree name");
  }
  const wtPath = await worktreeDir(base, repo.root, worktreeName);
  await removeWorktree(repo.root, wtPath);
  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.clean.v1",
        mode: "single",
        repoId,
        worktree: worktreeName,
        path: wtPath,
      },
      null,
      2,
    ));
  }
  return { code: 0 };
};
