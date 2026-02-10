import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { defaultAgentProfiles } from "./agent.ts";
import type { AgentKind } from "./agent.ts";
import { parseProfileNames } from "./profiles.ts";
import { expandPath, type LoadedPreset, loadPreset } from "./presets.ts";
import { saveSession } from "./sessions.ts";
import { repoIdForRoot } from "./paths.ts";
import {
  createWorkspace,
  findWorkspaceById,
  listWorkspaces,
} from "./workspace.ts";
import type { Exit } from "./main.ts";
import { boolFlag, parsePathList, requireStringFlag } from "./flags.ts";
import { validateWorktreeName } from "./validate.ts";
import { resolveExecCapability, resolveNetworkCapability } from "./caps.ts";

const workspaceUsageMain =
  "macbox workspace: new | list | show <id> | open <id>";
const workspaceUsageNew =
  "macbox workspace new [--json] [--name <label>] [--issue <number>] [--preset <name>] " +
  "[--profile <name[,name2...]>] [--branch <start-point>] [--worktree <name>] " +
  "[--allow-network|--block-network] [--allow-exec|--block-exec] " +
  "[--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--repo <path>] [--base <path>]";
const workspaceUsageList =
  "macbox workspace list [--json] [--all] [--repo <path>] [--base <path>]";
const workspaceUsageShow =
  "macbox workspace show <id> [--json] [--base <path>]";
const workspaceUsageOpen =
  "macbox workspace open <id> [--json] [--base <path>]";

const workspaceUsageFor = (sub?: string): string => {
  switch (sub) {
    case "new":
      return workspaceUsageNew;
    case "list":
      return workspaceUsageList;
    case "show":
      return workspaceUsageShow;
    case "open":
      return workspaceUsageOpen;
    default:
      return workspaceUsageMain;
  }
};

const printWorkspaceUsage = (json: boolean, sub?: string) => {
  const usage = workspaceUsageFor(sub);
  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.workspace.usage.v1",
        subcommand: sub ?? null,
        usage,
      },
      null,
      2,
    ));
    return;
  }
  console.log(usage);
};

const mergePaths = (
  ...parts: ReadonlyArray<ReadonlyArray<string>>
): string[] => {
  const set = new Set<string>();
  for (const xs of parts) {
    for (const p of xs) {
      const expanded = expandPath(p);
      if (expanded) set.add(expanded);
    }
  }
  return [...set.values()];
};

export const workspaceCmd = async (
  argv: ReadonlyArray<string>,
): Promise<Exit> => {
  const a = parseArgs(argv);
  const sub = a._[0] as string | undefined;
  const json = boolFlag(a.flags.json, false);

  if (!sub) {
    printWorkspaceUsage(json);
    return { code: 0 };
  }
  if (sub === "help") {
    printWorkspaceUsage(json, a._[1] as string | undefined);
    return { code: 0 };
  }
  if (a.flags.help) {
    printWorkspaceUsage(json, sub);
    return { code: 0 };
  }

  switch (sub) {
    case "new":
      return await workspaceNew(a, json);
    case "list":
      return await workspaceList(a, json);
    case "show":
      return await workspaceShow(a, json);
    case "open":
      return await workspaceOpen(a, json);
    default:
      printWorkspaceUsage(json);
      return { code: 2 };
  }
};

const workspaceNew = async (
  a: ReturnType<typeof parseArgs>,
  json: boolean,
): Promise<Exit> => {
  const base = requireStringFlag("base", a.flags.base) ?? defaultBaseDir();
  const repoHint = requireStringFlag("repo", a.flags.repo);
  const name = requireStringFlag("name", a.flags.name);
  const issueRaw = requireStringFlag("issue", a.flags.issue);
  const issue = issueRaw === undefined ? undefined : (() => {
    if (!/^\d+$/.test(issueRaw)) {
      throw new Error("macbox: --issue must be an integer");
    }
    const parsed = Number(issueRaw);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error("macbox: --issue value is too large");
    }
    return parsed;
  })();
  const presetName = requireStringFlag("preset", a.flags.preset);
  const profileFlag = requireStringFlag("profile", a.flags.profile);
  const startPoint = requireStringFlag("branch", a.flags.branch) ?? "HEAD";
  const allowFsReadRaw = requireStringFlag(
    "allow-fs-read",
    a.flags["allow-fs-read"],
  );
  const allowFsWriteRaw = requireStringFlag(
    "allow-fs-rw",
    a.flags["allow-fs-rw"],
  );

  // Load preset
  let presetConfig: LoadedPreset | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
    for (const w of presetConfig.warnings) {
      console.error(`macbox: WARNING: ${w}`);
    }
  }

  // Resolve agent from preset (no CLI --agent flag)
  const presetAgent = presetConfig?.preset.agent;
  const agentFlag: AgentKind = presetAgent ?? "custom";
  // Detect repo and compute repoId
  const repo = await detectRepo(repoHint);
  const repoId = await repoIdForRoot(repo.root);

  // Determine worktree name
  const worktreeNameDefault = issue
    ? `ws-issue-${issue}`
    : presetConfig?.preset.worktreePrefix
    ? `${presetConfig.preset.worktreePrefix}-ws`
    : "ws";

  const worktreeName = validateWorktreeName(
    requireStringFlag("worktree", a.flags.worktree) ?? worktreeNameDefault,
  );
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
  const network = resolveNetworkCapability({
    allowNetwork: a.flags["allow-network"],
    blockNetwork: a.flags["block-network"],
    noNetwork: a.flags["no-network"],
    dflt: presetConfig?.preset.capabilities?.network ?? true,
  });
  const exec = resolveExecCapability({
    allowExec: a.flags["allow-exec"],
    blockExec: a.flags["block-exec"],
    dflt: presetConfig?.preset.capabilities?.exec ?? true,
  });

  const presetExtraRead = presetConfig?.preset.capabilities?.extraReadPaths ??
    [];
  const presetExtraWrite = presetConfig?.preset.capabilities?.extraWritePaths ??
    [];
  const cliExtraRead = parsePathList(allowFsReadRaw);
  const cliExtraWrite = parsePathList(allowFsWriteRaw);

  const mergedExtraRead = mergePaths(presetExtraRead, cliExtraRead);
  const mergedExtraWrite = mergePaths(presetExtraWrite, cliExtraWrite);

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
    repoId,
    sessionId: session.id,
    worktreeName,
    worktreePath: wtPath,
    name,
  });

  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.workspace.new.v1",
        workspace: ws,
        sessionId: session.id,
        repoId,
        issue,
      },
      null,
      2,
    ));
  } else {
    console.log(`macbox: workspace created`);
    console.log(`  id:        ${ws.id}`);
    console.log(`  repo:      ${repoId}`);
    console.log(`  worktree:  ${worktreeName}`);
    console.log(`  path:      ${wtPath}`);
    if (issue) console.log(`  issue:     #${issue}`);
    console.log(`  session:   ${session.id}`);
  }

  return { code: 0 };
};

const workspaceList = async (
  a: ReturnType<typeof parseArgs>,
  json: boolean,
): Promise<Exit> => {
  const base = requireStringFlag("base", a.flags.base) ?? defaultBaseDir();
  const showAll = boolFlag(a.flags.all, false);
  const repoHint = requireStringFlag("repo", a.flags.repo);

  let repoId: string | undefined;
  if (!showAll) {
    try {
      const repo = await detectRepo(repoHint);
      repoId = await repoIdForRoot(repo.root);
    } catch {
      // Not in a repo, show all
    }
  }

  const workspaces = await listWorkspaces({ baseDir: base, repoId });

  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.workspace.list.v1",
        workspaces,
      },
      null,
      2,
    ));
    return { code: 0 };
  }

  if (workspaces.length === 0) {
    console.log("macbox: no workspaces found.");
    return { code: 0 };
  }

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log(
    `${pad("ID", 14)}  ${pad("WORKTREE", 20)}  ${pad("NAME", 15)}  ACCESSED`,
  );
  for (const ws of workspaces) {
    const label = ws.name ?? "";
    console.log(
      `${pad(ws.id, 14)}  ${pad(ws.worktreeName, 20)}  ${pad(label, 15)}  ${
        ws.lastAccessedAt.slice(0, 19)
      }`,
    );
  }
  return { code: 0 };
};

const workspaceShow = async (
  a: ReturnType<typeof parseArgs>,
  json: boolean,
): Promise<Exit> => {
  const base = requireStringFlag("base", a.flags.base) ?? defaultBaseDir();
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

  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.workspace.show.v1",
        workspace: ws,
      },
      null,
      2,
    ));
    return { code: 0 };
  }

  console.log(JSON.stringify(ws, null, 2));
  return { code: 0 };
};

const workspaceOpen = async (
  a: ReturnType<typeof parseArgs>,
  json: boolean,
): Promise<Exit> => {
  const base = requireStringFlag("base", a.flags.base) ?? defaultBaseDir();
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

  if (json) {
    console.log(JSON.stringify(
      {
        schema: "macbox.workspace.open.v1",
        workspaceId: wsId,
        sessionId: ws.sessionId,
        path: ws.worktreePath,
        continueCommand: `macbox --session ${ws.sessionId} --prompt "continue"`,
      },
      null,
      2,
    ));
    return { code: 0 };
  }

  // Print session info and an explicit continuation command.
  console.log(`macbox: workspace ${wsId} ready`);
  console.log(`  session: ${ws.sessionId}`);
  console.log(`  path:    ${ws.worktreePath}`);
  console.log(
    `\nContinue with: macbox --session ${ws.sessionId} --prompt "continue"`,
  );
  return { code: 0 };
};
