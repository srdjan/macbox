import { runFlow, type FlowResult } from "./flow_engine.ts";
import type { FlowDef } from "./flow_config.ts";
import { loadWorkspace } from "./workspace.ts";
import { loadSessionById } from "./sessions.ts";
import type { AgentKind } from "./agent.ts";

export type SwarmRequest = {
  readonly flowName: string;
  readonly flowDef: FlowDef;
  readonly baseDir: string;
  readonly workspaceIds: ReadonlyArray<string>;
  readonly projectId: string;
  readonly maxParallel: number;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly env?: Record<string, string>;
  readonly debug?: boolean;
};

export type SwarmWorkspaceResult = {
  readonly workspaceId: string;
  readonly flowResult: FlowResult;
};

export type SwarmResult = {
  readonly schema: "macbox.swarm.result.v1";
  readonly flowName: string;
  readonly results: ReadonlyArray<SwarmWorkspaceResult>;
  readonly summary: {
    readonly total: number;
    readonly succeeded: number;
    readonly failed: number;
  };
  readonly startedAt: string;
  readonly completedAt: string;
};

const isoNow = () => new Date().toISOString();

export const runWithLimit = async <T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<ReadonlyArray<T>> => {
  const results: T[] = [];
  let index = 0;

  const runNext = async (): Promise<void> => {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
};

export const runSwarm = async (req: SwarmRequest): Promise<SwarmResult> => {
  const startedAt = isoNow();

  const tasks = req.workspaceIds.map((wsId) => async (): Promise<SwarmWorkspaceResult> => {
    console.error(`macbox: swarm: starting flow '${req.flowName}' in workspace ${wsId}`);

    const ws = await loadWorkspace({
      baseDir: req.baseDir,
      projectId: req.projectId,
      workspaceId: wsId,
    });
    const session = await loadSessionById({ baseDir: req.baseDir, id: ws.sessionId });

    const flowResult = await runFlow({
      flowName: req.flowName,
      flowDef: req.flowDef,
      worktreePath: ws.worktreePath,
      repoRoot: session.repoRoot,
      gitCommonDir: session.gitCommonDir,
      gitDir: session.gitDir,
      workspaceId: ws.id,
      agent: req.agent ?? session.agent,
      profiles: req.profiles,
      env: req.env,
      debug: req.debug,
    });

    const status = flowResult.ok ? "succeeded" : "failed";
    console.error(`macbox: swarm: workspace ${wsId} ${status}`);

    return { workspaceId: wsId, flowResult };
  });

  const results = await runWithLimit(tasks, req.maxParallel);

  const succeeded = results.filter((r) => r.flowResult.ok).length;
  const failed = results.length - succeeded;

  return {
    schema: "macbox.swarm.result.v1",
    flowName: req.flowName,
    results,
    summary: {
      total: results.length,
      succeeded,
      failed,
    },
    startedAt,
    completedAt: isoNow(),
  };
};
