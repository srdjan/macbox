import type { HooksDef, StepDef, MacboxConfig } from "./flow_config.ts";
import { runSteps } from "./flow_engine.ts";
import type { FlowResult } from "./flow_engine.ts";
import type { AgentKind } from "./agent.ts";
import type { SessionCaps } from "./sessions.ts";

export type HookContext = {
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly caps?: Partial<SessionCaps>;
  readonly env?: Record<string, string>;
  readonly debug?: boolean;
};

export const runHook = async (
  hookName: keyof HooksDef,
  config: MacboxConfig,
  ctx: HookContext,
): Promise<FlowResult | null> => {
  const hooks = config.hooks;
  if (!hooks) return null;

  const steps = hooks[hookName];
  if (!steps || steps.length === 0) return null;

  console.error(`macbox: running hook: ${hookName}`);

  return await runSteps({
    name: `hook:${hookName}`,
    steps,
    worktreePath: ctx.worktreePath,
    repoRoot: ctx.repoRoot,
    gitCommonDir: ctx.gitCommonDir,
    gitDir: ctx.gitDir,
    agent: ctx.agent,
    profiles: ctx.profiles,
    caps: ctx.caps,
    env: ctx.env,
    debug: ctx.debug,
  });
};
