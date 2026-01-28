import type { FlowDef, StepDef } from "./flow_config.ts";
import { executeStep, type StepContext, type StepResult } from "./flow_steps.ts";
import { ensureDir } from "./fs.ts";
import { pathJoin, nowCompact } from "./os.ts";
import { flowResultsDir } from "./paths.ts";
import type { AgentKind } from "./agent.ts";
import type { SessionCaps } from "./sessions.ts";

// --- Step output interpolation ---

const buildResultIndex = (
  results: ReadonlyArray<StepResult>,
): ReadonlyMap<string, StepResult> => {
  const m = new Map<string, StepResult>();
  for (const r of results) m.set(r.stepId, r);
  return m;
};

const resolveRef = (
  stepId: string,
  path: string,
  index: ReadonlyMap<string, StepResult>,
): string => {
  const result = index.get(stepId);
  if (!result) return "";
  if (path === "exitCode") return String(result.exitCode);
  if (path === "stdout") return result.stdout ?? "";
  if (path === "stderr") return result.stderr ?? "";
  if (path.startsWith("outputs.")) {
    const key = path.slice("outputs.".length);
    return result.outputs[key] ?? "";
  }
  return "";
};

const interpolateValue = (
  value: unknown,
  index: ReadonlyMap<string, StepResult>,
): unknown => {
  if (typeof value === "string") {
    return value.replace(
      /\$\{steps\.([^.}]+)\.([^}]+)\}/g,
      (_match, stepId, path) => resolveRef(stepId as string, path as string, index),
    );
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateValue(v, index));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateValue(v, index);
    }
    return out;
  }
  return value;
};

const interpolateStep = (
  step: StepDef,
  previousResults: ReadonlyArray<StepResult>,
): StepDef => {
  if (!step.args) return step;
  const index = buildResultIndex(previousResults);
  return { ...step, args: interpolateValue(step.args, index) as Record<string, unknown> };
};

export type FlowResult = {
  readonly schema: "macbox.flow.result.v1";
  readonly flowName: string;
  readonly workspaceId?: string;
  readonly ok: boolean;
  readonly steps: ReadonlyArray<StepResult>;
  readonly startedAt: string;
  readonly completedAt: string;
};

const isoNow = () => new Date().toISOString();

export const runFlow = async (args: {
  readonly flowName: string;
  readonly flowDef: FlowDef;
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly workspaceId?: string;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly caps?: Partial<SessionCaps>;
  readonly env?: Record<string, string>;
  readonly debug?: boolean;
}): Promise<FlowResult> => {
  const startedAt = isoNow();
  const results: StepResult[] = [];
  let allOk = true;

  const ctx: StepContext = {
    worktreePath: args.worktreePath,
    repoRoot: args.repoRoot,
    gitCommonDir: args.gitCommonDir,
    gitDir: args.gitDir,
    agent: args.agent,
    profiles: args.profiles,
    caps: args.caps,
    env: args.env,
    previousResults: results,
    debug: args.debug ?? false,
  };

  for (const step of args.flowDef.steps) {
    console.error(`macbox: flow/${args.flowName}: running step ${step.id} (${step.type})`);

    const resolved = interpolateStep(step, results);
    const result = await executeStep(resolved, ctx);
    results.push(result);

    if (result.exitCode !== 0) {
      allOk = false;
      if (!step.continueOnError) {
        console.error(
          `macbox: flow/${args.flowName}: step ${step.id} failed (exit ${result.exitCode})`,
        );
        if (result.error) {
          console.error(`  error: ${result.error}`);
        }
        break;
      }
      console.error(
        `macbox: flow/${args.flowName}: step ${step.id} failed (exit ${result.exitCode}), continuing`,
      );
    }
  }

  const flowResult: FlowResult = {
    schema: "macbox.flow.result.v1",
    flowName: args.flowName,
    workspaceId: args.workspaceId,
    ok: allOk,
    steps: results,
    startedAt,
    completedAt: isoNow(),
  };

  // Persist flow result
  try {
    await persistFlowResult(args.worktreePath, args.flowName, flowResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`macbox: failed to persist flow result: ${msg}`);
  }

  return flowResult;
};

const persistFlowResult = async (
  worktreePath: string,
  flowName: string,
  result: FlowResult,
) => {
  const dir = flowResultsDir(worktreePath);
  await ensureDir(dir);
  const filename = `${flowName}-${nowCompact()}.json`;
  const filePath = pathJoin(dir, filename);
  await Deno.writeTextFile(
    filePath,
    JSON.stringify(result, null, 2) + "\n",
    { create: true },
  );
};

export const runSteps = async (args: {
  readonly name: string;
  readonly steps: ReadonlyArray<StepDef>;
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly caps?: Partial<SessionCaps>;
  readonly env?: Record<string, string>;
  readonly debug?: boolean;
}): Promise<FlowResult> => {
  return await runFlow({
    flowName: args.name,
    flowDef: { steps: args.steps },
    worktreePath: args.worktreePath,
    repoRoot: args.repoRoot,
    gitCommonDir: args.gitCommonDir,
    gitDir: args.gitDir,
    agent: args.agent,
    profiles: args.profiles,
    caps: args.caps,
    env: args.env,
    debug: args.debug,
  });
};
