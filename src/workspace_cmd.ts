import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree, removeWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { sandboxEnv } from "./env.ts";
import { defaultAgentProfiles } from "./agent.ts";
import type { AgentKind } from "./agent.ts";
import { loadProfiles, parseProfileNames } from "./profiles.ts";
import { expandPath, loadPreset, type LoadedPreset } from "./presets.ts";
import { saveSession, loadSessionById } from "./sessions.ts";
import { repoIdForRoot } from "./paths.ts";
import {
  createWorkspace,
  findWorkspaceById,
  listWorkspaces,
  updateWorkspace,
} from "./workspace.ts";
import { loadMacboxConfig } from "./flow_config.ts";
import type { Exit } from "./main.ts";
import { asString, boolFlag, parsePathList } from "./flags.ts";

export const workspaceCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const sub = a._[0] as string | undefined;

  switch (sub) {
    case "new":
      return await workspaceNew(a);
    case "list":
      return await workspaceList(a);
    case "show":
      return await workspaceShow(a);
    case "open":
      return await workspaceOpen(a);
    case "archive":
      return await workspaceArchive(a);
    case "restore":
      return await workspaceRestore(a);
    default:
      console.log(`macbox workspace: new | list | show <id> | open <id> | archive <id> | restore <id>`);
      return { code: sub ? 2 : 0 };
  }
};

const workspaceNew = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const name = asString(a.flags.name);
  const issueRaw = asString(a.flags.issue);
  const issue = issueRaw ? parseInt(issueRaw, 10) : undefined;
  const presetName = asString(a.flags.preset);
  const profileFlag = asString(a.flags.profile);
  const startPoint = asString(a.flags.branch) ?? "HEAD";

  // Load preset
  let presetConfig: LoadedPreset | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
  }

  // Resolve agent from preset (no CLI --agent flag)
  const presetAgent = presetConfig?.preset.agent;
  const agentFlag: AgentKind = presetAgent ?? "custom";
  const agent: AgentKind | undefined = agentFlag === "custom" ? undefined : agentFlag;

  // Detect repo and compute repoId
  const repo = await detectRepo(repoHint);
  const repoId = await repoIdForRoot(repo.root);

  // Determine worktree name
  const worktreeNameDefault = issue
    ? `ws-issue-${issue}`
    : presetConfig?.preset.worktreePrefix
    ? `${presetConfig.preset.worktreePrefix}-ws`
    : "ws";

  const worktreeName = asString(a.flags.worktree) ?? worktreeNameDefault;
  const wtPath = await worktreeDir(base, repo.root, worktreeName);
  const wtBranch = `macbox/${worktreeName}`;
  const actualStartPoint = presetConfig?.preset.startPoint ?? startPoint;

  // Create worktree
  await ensureWorktree(repo.root, wtPath, wtBranch, actualStartPoint);

  // Create sandbox dirs
  const mp = `${wtPath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  // Compose profiles
  const agentProfiles = defaultAgentProfiles(agentFlag);
  const profileNames = [
    ...agentProfiles,
    ...(presetConfig?.preset.profiles ?? []),
    ...parseProfileNames(profileFlag),
  ];

  // Merge capabilities
  const network = boolFlag(a.flags["allow-network"], presetConfig?.preset.capabilities?.network ?? true);
  const exec = boolFlag(a.flags["allow-exec"], presetConfig?.preset.capabilities?.exec ?? true);

  const presetExtraRead = (presetConfig?.preset.capabilities?.extraReadPaths ?? []).map(expandPath);
  const presetExtraWrite = (presetConfig?.preset.capabilities?.extraWritePaths ?? []).map(expandPath);
  const cliExtraRead = parsePathList(a.flags["allow-fs-read"]);
  const cliExtraWrite = parsePathList(a.flags["allow-fs-rw"]);

  const mergedExtraRead = [...presetExtraRead, ...cliExtraRead];
  const mergedExtraWrite = [...presetExtraWrite, ...cliExtraWrite];

  // Create session
  const session = await saveSession({
    baseDir: base,
    repoRoot: repo.root,
    worktreeName,
    worktreePath: wtPath,
    gitCommonDir: repo.gitCommonDir,
    gitDir: repo.gitDir,
    agent: agentFlag,
    preset: presetConfig?.preset.name,
    presetSource: presetConfig?.source,
    profiles: profileNames,
    caps: {
      network,
      exec,
      extraRead: mergedExtraRead,
      extraWrite: mergedExtraWrite,
    },
    debug: false,
    trace: false,
  });

  // Create workspace
  const ws = await createWorkspace({
    baseDir: base,
    projectId: repoId,
    sessionId: session.id,
    worktreeName,
    worktreePath: wtPath,
    name,
    parent: {
      branch: repo.branch,
      issue,
    },
  });

  console.log(`macbox: workspace created`);
  console.log(`  id:        ${ws.id}`);
  console.log(`  repo:      ${repoId}`);
  console.log(`  worktree:  ${worktreeName}`);
  console.log(`  path:      ${wtPath}`);
  if (issue) console.log(`  issue:     #${issue}`);
  console.log(`  session:   ${session.id}`);

  return { code: 0 };
};

const workspaceList = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const showAll = boolFlag(a.flags.all, false);
  const showArchived = boolFlag(a.flags.archived, false);
  const repoHint = asString(a.flags.repo);

  let projectId: string | undefined;
  if (!showAll) {
    try {
      const repo = await detectRepo(repoHint);
      projectId = await repoIdForRoot(repo.root);
    } catch {
      // Not in a repo, show all
    }
  }

  const status = showArchived ? "archived" as const : undefined;
  const workspaces = await listWorkspaces({ baseDir: base, projectId, status });

  if (workspaces.length === 0) {
    console.log("macbox: no workspaces found.");
    return { code: 0 };
  }

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log(`${pad("ID", 14)}  ${pad("STATUS", 8)}  ${pad("WORKTREE", 20)}  ${pad("NAME", 15)}  UPDATED`);
  for (const ws of workspaces) {
    const issueTag = ws.parent.issue ? ` (#${ws.parent.issue})` : "";
    const label = (ws.name ?? "") + issueTag;
    console.log(
      `${pad(ws.id, 14)}  ${pad(ws.status, 8)}  ${pad(ws.worktreeName, 20)}  ${pad(label, 15)}  ${ws.updatedAt.slice(0, 19)}`,
    );
  }
  return { code: 0 };
};

const workspaceShow = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const wsId = a._[1] as string | undefined;
  if (!wsId) {
    console.error("macbox workspace show: provide a workspace id");
    return { code: 2 };
  }

  const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
  if (!ws) {
    console.error(`macbox: workspace not found: ${wsId}`);
    return { code: 1 };
  }

  console.log(JSON.stringify(ws, null, 2));
  return { code: 0 };
};

const workspaceOpen = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const wsId = a._[1] as string | undefined;
  if (!wsId) {
    console.error("macbox workspace open: provide a workspace id");
    return { code: 2 };
  }

  const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
  if (!ws) {
    console.error(`macbox: workspace not found: ${wsId}`);
    return { code: 1 };
  }

  if (ws.status === "archived") {
    console.error(`macbox: workspace is archived. Use 'macbox workspace restore ${wsId}' first.`);
    return { code: 1 };
  }

  // Delegate to attach by printing session info
  console.log(`macbox: workspace ${wsId} ready`);
  console.log(`  session: ${ws.sessionId}`);
  console.log(`  path:    ${ws.worktreePath}`);
  console.log(`\nTo attach: macbox attach ${ws.sessionId}`);
  return { code: 0 };
};

const workspaceArchive = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const wsId = a._[1] as string | undefined;
  const evict = boolFlag(a.flags.evict, false);
  if (!wsId) {
    console.error("macbox workspace archive: provide a workspace id");
    return { code: 2 };
  }

  const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
  if (!ws) {
    console.error(`macbox: workspace not found: ${wsId}`);
    return { code: 1 };
  }

  if (ws.status === "archived") {
    console.error(`macbox: workspace is already archived`);
    return { code: 1 };
  }

  // Evict worktree from disk if requested
  if (evict) {
    try {
      const session = await loadSessionById({ baseDir: base, id: ws.sessionId });
      await removeWorktree(session.repoRoot, ws.worktreePath);
      console.log(`macbox: worktree evicted from disk`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`macbox: warning: failed to evict worktree: ${msg}`);
    }
  }

  const updated = await updateWorkspace({
    baseDir: base,
    workspace: ws,
    updates: {
      status: "archived",
      archive: {
        archivedAt: new Date().toISOString(),
        branchPointer: `macbox/${ws.worktreeName}`,
        worktreeEvicted: evict,
      },
    },
  });

  console.log(`macbox: workspace archived: ${updated.id}`);
  console.log(`  branch pointer: macbox/${ws.worktreeName}`);
  if (evict) {
    console.log(`  worktree removed from disk`);
  } else {
    console.log(`  worktree kept on disk (use --evict to remove)`);
  }
  return { code: 0 };
};

const workspaceRestore = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const wsId = a._[1] as string | undefined;
  if (!wsId) {
    console.error("macbox workspace restore: provide a workspace id");
    return { code: 2 };
  }

  const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
  if (!ws) {
    console.error(`macbox: workspace not found: ${wsId}`);
    return { code: 1 };
  }

  if (ws.status !== "archived") {
    console.error(`macbox: workspace is not archived`);
    return { code: 1 };
  }

  // Re-create worktree if it was evicted
  if (ws.archive?.worktreeEvicted) {
    try {
      const session = await loadSessionById({ baseDir: base, id: ws.sessionId });
      const branchPointer = ws.archive.branchPointer ?? `macbox/${ws.worktreeName}`;
      await ensureWorktree(session.repoRoot, ws.worktreePath, branchPointer, branchPointer);
      console.log(`macbox: worktree re-created from branch ${branchPointer}`);

      // Re-create sandbox dirs
      const mp = `${ws.worktreePath}/.macbox`;
      await ensureDir(`${mp}/home`);
      await ensureDir(`${mp}/cache`);
      await ensureDir(`${mp}/tmp`);
      await ensureDir(`${mp}/logs`);
      await ensureGitignoreInmacbox(ws.worktreePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`macbox: failed to re-create worktree: ${msg}`);
      return { code: 1 };
    }
  }

  const updated = await updateWorkspace({
    baseDir: base,
    workspace: ws,
    updates: {
      status: "active",
      archive: undefined,
    },
  });

  console.log(`macbox: workspace restored: ${updated.id}`);
  return { code: 0 };
};
