import { parseArgs } from "./mini_args.ts";
import { detectRepo } from "./git.ts";
import { defaultBaseDir } from "./paths.ts";
import { loadMacboxConfig } from "./flow_config.ts";
import { findOrCreateProject } from "./project.ts";
import { runSwarm, type SwarmResult } from "./swarm.ts";
import { workspaceCmd } from "./workspace_cmd.ts";
import { listWorkspaces } from "./workspace.ts";
import type { Exit } from "./main.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === "string" ? v : v ? "true" : "false";

const boolFlag = (v: string | boolean | undefined, dflt: boolean): boolean => {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "1" || v === "yes";
};

export const swarmCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const sub = a._[0] as string | undefined;

  switch (sub) {
    case "run":
      return await swarmRun(a);
    case "new":
      return await swarmNew(a);
    default:
      console.log(`macbox swarm: run --flow <name> --workspaces w1,w2,w3 | new --count N [--issue N] [--flow <name>]`);
      return { code: sub ? 2 : 0 };
  }
};

const swarmRun = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const flowName = asString(a.flags.flow);
  const wsRaw = asString(a.flags.workspaces);
  const maxParallel = parseInt(asString(a.flags["max-parallel"]) ?? "3", 10);
  const json = boolFlag(a.flags.json, false);
  const debug = boolFlag(a.flags.debug, false);

  if (!flowName) {
    console.error("macbox swarm run: --flow <name> required");
    return { code: 2 };
  }

  if (!wsRaw) {
    console.error("macbox swarm run: --workspaces <id1,id2,...> required");
    return { code: 2 };
  }

  const workspaceIds = wsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (workspaceIds.length === 0) {
    console.error("macbox swarm run: no workspace ids provided");
    return { code: 2 };
  }

  const repo = await detectRepo(repoHint);
  const project = await findOrCreateProject(repo.root);

  const config = await loadMacboxConfig(repo.root);
  if (!config?.flows?.[flowName]) {
    console.error(`macbox: flow '${flowName}' not found in macbox.json`);
    return { code: 1 };
  }

  const result = await runSwarm({
    flowName,
    flowDef: config.flows[flowName],
    baseDir: base,
    workspaceIds,
    projectId: project.projectId,
    maxParallel,
    agent: config.defaults?.agent,
    profiles: config.defaults?.profiles,
    debug,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSwarmResult(result);
  }

  return { code: result.summary.failed > 0 ? 1 : 0 };
};

const printSwarmResult = (result: SwarmResult) => {
  console.log(`\nmacbox swarm: ${result.flowName}`);
  console.log(`  total: ${result.summary.total}, succeeded: ${result.summary.succeeded}, failed: ${result.summary.failed}`);

  for (const r of result.results) {
    const status = r.flowResult.ok ? "[ok]" : "[fail]";
    console.log(`  ${status} ${r.workspaceId}: ${r.flowResult.steps.length} steps`);
  }
};

const swarmNew = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const countRaw = asString(a.flags.count);
  const issue = asString(a.flags.issue);
  const flowName = asString(a.flags.flow);
  const preset = asString(a.flags.preset);
  const agent = asString(a.flags.agent);

  if (!countRaw) {
    console.error("macbox swarm new: --count N required");
    return { code: 2 };
  }
  const count = parseInt(countRaw, 10);
  if (isNaN(count) || count < 1 || count > 20) {
    console.error("macbox swarm new: --count must be between 1 and 20");
    return { code: 2 };
  }

  const createdIds: string[] = [];

  for (let i = 1; i <= count; i++) {
    const suffix = `-${i}`;
    const wsArgs = ["new"];
    if (issue) wsArgs.push("--issue", issue);
    if (preset) wsArgs.push("--preset", preset);
    if (agent) wsArgs.push("--agent", agent);
    if (repoHint) wsArgs.push("--repo", repoHint);
    wsArgs.push("--base", base);

    // Set a unique worktree name per workspace
    const worktreeName = issue ? `ws-issue-${issue}${suffix}` : `ws-swarm${suffix}`;
    wsArgs.push("--worktree", worktreeName);
    wsArgs.push("--name", `swarm-${i}`);

    const result = await workspaceCmd(wsArgs);
    if (result.code !== 0) {
      console.error(`macbox: swarm: failed to create workspace ${i}`);
      return result;
    }
  }

  // Collect workspace IDs from recently created workspaces
  const repo = await detectRepo(repoHint);
  const project = await findOrCreateProject(repo.root);
  const workspaces = await listWorkspaces({ baseDir: base, projectId: project.projectId, status: "active" });
  const recentIds = workspaces.slice(0, count).map((ws) => ws.id);

  console.log(`\nmacbox swarm: created ${count} workspaces`);
  for (const id of recentIds) {
    console.log(`  ${id}`);
  }

  // Optionally run a flow on all workspaces
  if (flowName) {
    const config = await loadMacboxConfig(repo.root);
    if (!config?.flows?.[flowName]) {
      console.error(`macbox: flow '${flowName}' not found, skipping swarm run`);
      return { code: 0 };
    }

    console.log(`\nmacbox swarm: running flow '${flowName}' on ${recentIds.length} workspaces`);
    const result = await runSwarm({
      flowName,
      flowDef: config.flows[flowName],
      baseDir: base,
      workspaceIds: recentIds,
      projectId: project.projectId,
      maxParallel: 3,
      agent: config.defaults?.agent,
      profiles: config.defaults?.profiles,
    });
    printSwarmResult(result);
  }

  return { code: 0 };
};
