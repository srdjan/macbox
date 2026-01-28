import { parseArgs } from "./mini_args.ts";
import { detectRepo } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import {
  createContextPack,
  listContextPacks,
  loadContextPack,
  contextPackDir,
} from "./context_pack.ts";
import { findWorkspaceById, updateWorkspace } from "./workspace.ts";
import { loadSessionById } from "./sessions.ts";
import type { Exit } from "./main.ts";
import { asString } from "./flags.ts";

export const contextCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const sub = a._[0] as string | undefined;

  switch (sub) {
    case "pack":
      return await contextPack(a);
    case "show":
      return await contextShow(a);
    case "list":
      return await contextList(a);
    default:
      console.log(`macbox context: pack | show <packId> | list`);
      return { code: sub ? 2 : 0 };
  }
};

const contextPack = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const wsId = asString(a.flags.workspace);
  const summary = asString(a.flags.summary);
  const repoHint = asString(a.flags.repo);

  let worktreePath: string;
  let workspaceId: string | undefined;

  if (wsId) {
    const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
    if (!ws) {
      console.error(`macbox: workspace not found: ${wsId}`);
      return { code: 1 };
    }
    worktreePath = ws.worktreePath;
    workspaceId = ws.id;
  } else {
    const worktreeFlag = asString(a.flags.worktree);
    if (worktreeFlag) {
      const repo = await detectRepo(repoHint);
      worktreePath = await worktreeDir(base, repo.root, worktreeFlag);
    } else {
      const repo = await detectRepo(repoHint);
      worktreePath = repo.root;
    }
  }

  const pack = await createContextPack({
    worktreePath,
    workspaceId,
    summary: summary ?? undefined,
  });

  // Update workspace if applicable
  if (wsId && workspaceId) {
    try {
      const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
      if (ws) {
        await updateWorkspace({
          baseDir: base,
          workspace: ws,
          updates: {
            contextPacks: [...ws.contextPacks, pack.packId],
          },
        });
      }
    } catch {
      // Non-fatal
    }
  }

  console.log(`macbox: context pack created`);
  console.log(`  packId:  ${pack.packId}`);
  console.log(`  branch:  ${pack.repoState.branch}`);
  console.log(`  commit:  ${pack.repoState.commitSha.slice(0, 8)}`);
  console.log(`  dirty:   ${pack.repoState.dirty}`);
  console.log(`  path:    ${contextPackDir(worktreePath, pack.packId)}`);

  return { code: 0 };
};

const contextShow = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const packId = a._[1] as string | undefined;
  const repoHint = asString(a.flags.repo);

  if (!packId) {
    console.error("macbox context show: provide a pack id");
    return { code: 2 };
  }

  const wsId = asString(a.flags.workspace);
  let worktreePath: string;

  if (wsId) {
    const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
    if (!ws) {
      console.error(`macbox: workspace not found: ${wsId}`);
      return { code: 1 };
    }
    worktreePath = ws.worktreePath;
  } else {
    const worktreeFlag = asString(a.flags.worktree);
    if (worktreeFlag) {
      const repo = await detectRepo(repoHint);
      worktreePath = await worktreeDir(base, repo.root, worktreeFlag);
    } else {
      const repo = await detectRepo(repoHint);
      worktreePath = repo.root;
    }
  }

  try {
    const pack = await loadContextPack(worktreePath, packId);
    console.log(JSON.stringify(pack, null, 2));
  } catch {
    console.error(`macbox: context pack not found: ${packId}`);
    return { code: 1 };
  }

  return { code: 0 };
};

const contextList = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const wsId = asString(a.flags.workspace);

  let worktreePath: string;

  if (wsId) {
    const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
    if (!ws) {
      console.error(`macbox: workspace not found: ${wsId}`);
      return { code: 1 };
    }
    worktreePath = ws.worktreePath;
  } else {
    const worktreeFlag = asString(a.flags.worktree);
    if (worktreeFlag) {
      const repo = await detectRepo(repoHint);
      worktreePath = await worktreeDir(base, repo.root, worktreeFlag);
    } else {
      const repo = await detectRepo(repoHint);
      worktreePath = repo.root;
    }
  }

  const packs = await listContextPacks(worktreePath);

  if (packs.length === 0) {
    console.log("macbox: no context packs found.");
    return { code: 0 };
  }

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log(`${pad("PACK ID", 16)}  ${pad("BRANCH", 20)}  ${pad("COMMIT", 10)}  ${pad("DIRTY", 6)}  CREATED`);
  for (const p of packs) {
    console.log(
      `${pad(p.packId, 16)}  ${pad(p.repoState.branch, 20)}  ${pad(p.repoState.commitSha.slice(0, 8), 10)}  ${pad(String(p.repoState.dirty), 6)}  ${p.createdAt.slice(0, 19)}`,
    );
  }
  return { code: 0 };
};
