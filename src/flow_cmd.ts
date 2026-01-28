import { parseArgs } from "./mini_args.ts";
import { detectRepo } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { loadMacboxConfig } from "./flow_config.ts";
import { runFlow, type FlowResult } from "./flow_engine.ts";
import { findWorkspaceById, updateWorkspace } from "./workspace.ts";
import { loadSessionById } from "./sessions.ts";
import type { Exit } from "./main.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === "string" ? v : v ? "true" : "false";

const boolFlag = (v: string | boolean | undefined, dflt: boolean): boolean => {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "1" || v === "yes";
};

export const flowCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const sub = a._[0] as string | undefined;

  switch (sub) {
    case "run":
      return await flowRun(a);
    case "list":
      return await flowList(a);
    case "show":
      return await flowShow(a);
    default:
      console.log(`macbox flow: run <name> | list | show <name>`);
      return { code: sub ? 2 : 0 };
  }
};

const flowRun = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const flowName = a._[1] as string | undefined;
  const wsId = asString(a.flags.workspace);
  const json = boolFlag(a.flags.json, false);
  const debug = boolFlag(a.flags.debug, false);

  if (!flowName) {
    console.error("macbox flow run: provide a flow name");
    return { code: 2 };
  }

  // Determine worktree path and repo info
  let worktreePath: string;
  let repoRoot: string;
  let gitCommonDir: string;
  let gitDir: string;
  let workspaceId: string | undefined;

  if (wsId) {
    // Workspace mode: load workspace and session
    const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
    if (!ws) {
      console.error(`macbox: workspace not found: ${wsId}`);
      return { code: 1 };
    }
    worktreePath = ws.worktreePath;
    workspaceId = ws.id;

    const session = await loadSessionById({ baseDir: base, id: ws.sessionId });
    repoRoot = session.repoRoot;
    gitCommonDir = session.gitCommonDir;
    gitDir = session.gitDir;
  } else {
    // Repo mode: detect current repo
    const repo = await detectRepo(repoHint);
    repoRoot = repo.root;
    gitCommonDir = repo.gitCommonDir;
    gitDir = repo.gitDir;

    // Use worktree flag or cwd
    const worktreeFlag = asString(a.flags.worktree);
    if (worktreeFlag) {
      worktreePath = await worktreeDir(base, repo.root, worktreeFlag);
    } else {
      worktreePath = repo.root;
    }
  }

  // Load macbox.json
  const config = await loadMacboxConfig(worktreePath, repoRoot);
  if (!config?.flows?.[flowName]) {
    console.error(`macbox: flow '${flowName}' not found in macbox.json`);
    if (config?.flows) {
      const names = Object.keys(config.flows).join(", ");
      console.error(`  available: ${names}`);
    }
    return { code: 1 };
  }

  const flowDef = config.flows[flowName];
  const agent = config.defaults?.agent;
  const profiles = config.defaults?.profiles;

  const result = await runFlow({
    flowName,
    flowDef,
    worktreePath,
    repoRoot,
    gitCommonDir,
    gitDir,
    workspaceId,
    agent,
    profiles,
    debug,
  });

  // Update workspace flowsRun if applicable
  if (wsId && workspaceId) {
    try {
      const ws = await findWorkspaceById({ baseDir: base, workspaceId: wsId });
      if (ws) {
        await updateWorkspace({
          baseDir: base,
          workspace: ws,
          updates: {
            flowsRun: [
              ...ws.flowsRun,
              {
                flowName,
                runAt: result.completedAt,
                exitCode: result.ok ? 0 : 1,
              },
            ],
          },
        });
      }
    } catch {
      // Non-fatal
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printFlowResult(result);
  }

  return { code: result.ok ? 0 : 1 };
};

const printFlowResult = (result: FlowResult) => {
  const status = result.ok ? "OK" : "FAILED";
  console.log(`\nmacbox flow: ${result.flowName} - ${status}`);
  console.log(`  steps: ${result.steps.length}`);

  for (const step of result.steps) {
    const icon = step.exitCode === 0 ? "[ok]" : step.skipped ? "[skip]" : "[fail]";
    const label = step.label ? ` (${step.label})` : "";
    console.log(`  ${icon} ${step.stepId}: ${step.type}${label}`);
    if (step.error) {
      console.log(`       error: ${step.error}`);
    }
  }
};

const flowList = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const repoHint = asString(a.flags.repo);
  const worktreeFlag = asString(a.flags.worktree);
  const base = asString(a.flags.base) ?? defaultBaseDir();

  let worktreePath: string;
  let repoRoot: string | undefined;

  if (worktreeFlag) {
    const repo = await detectRepo(repoHint);
    worktreePath = await worktreeDir(base, repo.root, worktreeFlag);
    repoRoot = repo.root;
  } else {
    const repo = await detectRepo(repoHint);
    worktreePath = repo.root;
    repoRoot = repo.root;
  }

  const config = await loadMacboxConfig(worktreePath, repoRoot);
  if (!config?.flows || Object.keys(config.flows).length === 0) {
    console.log("macbox: no flows defined in macbox.json");
    return { code: 0 };
  }

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log(`${pad("NAME", 20)}  ${pad("STEPS", 6)}  DESCRIPTION`);
  for (const [name, flow] of Object.entries(config.flows)) {
    const desc = flow.description ?? "";
    console.log(`${pad(name, 20)}  ${pad(String(flow.steps.length), 6)}  ${desc}`);
  }
  return { code: 0 };
};

const flowShow = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const repoHint = asString(a.flags.repo);
  const worktreeFlag = asString(a.flags.worktree);
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const flowName = a._[1] as string | undefined;

  if (!flowName) {
    console.error("macbox flow show: provide a flow name");
    return { code: 2 };
  }

  let worktreePath: string;
  let repoRoot: string | undefined;

  if (worktreeFlag) {
    const repo = await detectRepo(repoHint);
    worktreePath = await worktreeDir(base, repo.root, worktreeFlag);
    repoRoot = repo.root;
  } else {
    const repo = await detectRepo(repoHint);
    worktreePath = repo.root;
    repoRoot = repo.root;
  }

  const config = await loadMacboxConfig(worktreePath, repoRoot);
  if (!config?.flows?.[flowName]) {
    console.error(`macbox: flow '${flowName}' not found`);
    return { code: 1 };
  }

  console.log(JSON.stringify(config.flows[flowName], null, 2));
  return { code: 0 };
};
