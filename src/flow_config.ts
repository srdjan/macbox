import { pathJoin } from "./os.ts";
import type { AgentKind } from "./agent.ts";

export type StepDef = {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
  readonly args?: Record<string, unknown>;
  readonly continueOnError?: boolean;
};

export type FlowDef = {
  readonly description?: string;
  readonly steps: ReadonlyArray<StepDef>;
};

export type HooksDef = {
  readonly onWorkspaceCreate?: ReadonlyArray<StepDef>;
  readonly onWorkspaceRestore?: ReadonlyArray<StepDef>;
  readonly onFlowComplete?: ReadonlyArray<StepDef>;
};

export type MacboxConfig = {
  readonly schema: "macbox.config.v1";
  readonly flows?: Record<string, FlowDef>;
  readonly hooks?: HooksDef;
  readonly defaults?: {
    readonly agent?: AgentKind;
    readonly preset?: string;
    readonly profiles?: ReadonlyArray<string>;
  };
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

const validateStep = (raw: unknown, index: number, context: string): StepDef => {
  if (!isObj(raw)) {
    throw new Error(`macbox.json: ${context}[${index}] must be an object`);
  }
  const id = typeof raw.id === "string" ? raw.id : `step-${index}`;
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!type) {
    throw new Error(`macbox.json: ${context}[${index}] missing 'type'`);
  }
  return {
    id,
    type,
    label: typeof raw.label === "string" ? raw.label : undefined,
    args: isObj(raw.args) ? raw.args as Record<string, unknown> : undefined,
    continueOnError: typeof raw.continueOnError === "boolean" ? raw.continueOnError : undefined,
  };
};

const validateSteps = (raw: unknown, context: string): ReadonlyArray<StepDef> => {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => validateStep(s, i, context));
};

const validateFlow = (raw: unknown, name: string): FlowDef => {
  if (!isObj(raw)) {
    throw new Error(`macbox.json: flow '${name}' must be an object`);
  }
  const steps = validateSteps(raw.steps, `flows.${name}.steps`);
  if (steps.length === 0) {
    throw new Error(`macbox.json: flow '${name}' has no steps`);
  }
  return {
    description: typeof raw.description === "string" ? raw.description : undefined,
    steps,
  };
};

const validateHooks = (raw: unknown): HooksDef => {
  if (!isObj(raw)) return {};
  return {
    onWorkspaceCreate: raw.onWorkspaceCreate
      ? validateSteps(raw.onWorkspaceCreate, "hooks.onWorkspaceCreate")
      : undefined,
    onWorkspaceRestore: raw.onWorkspaceRestore
      ? validateSteps(raw.onWorkspaceRestore, "hooks.onWorkspaceRestore")
      : undefined,
    onFlowComplete: raw.onFlowComplete
      ? validateSteps(raw.onFlowComplete, "hooks.onFlowComplete")
      : undefined,
  };
};

const validateConfig = (raw: unknown): MacboxConfig => {
  if (!isObj(raw)) {
    throw new Error("macbox.json: expected an object at root");
  }

  const flows: Record<string, FlowDef> = {};
  if (isObj(raw.flows)) {
    for (const [name, def] of Object.entries(raw.flows as Record<string, unknown>)) {
      flows[name] = validateFlow(def, name);
    }
  }

  const hooks = isObj(raw.hooks) ? validateHooks(raw.hooks) : undefined;

  const defaults = isObj(raw.defaults)
    ? {
        agent: typeof (raw.defaults as Record<string, unknown>).agent === "string"
          ? (raw.defaults as Record<string, unknown>).agent as AgentKind
          : undefined,
        preset: typeof (raw.defaults as Record<string, unknown>).preset === "string"
          ? (raw.defaults as Record<string, unknown>).preset as string
          : undefined,
        profiles: Array.isArray((raw.defaults as Record<string, unknown>).profiles)
          ? ((raw.defaults as Record<string, unknown>).profiles as unknown[]).filter(
              (x) => typeof x === "string",
            ) as string[]
          : undefined,
      }
    : undefined;

  return {
    schema: "macbox.config.v1",
    flows: Object.keys(flows).length ? flows : undefined,
    hooks,
    defaults,
  };
};

export const loadMacboxConfig = async (
  worktreePath: string,
  repoRoot?: string,
): Promise<MacboxConfig | null> => {
  // Try worktree first, then repo root
  const candidates = [
    pathJoin(worktreePath, "macbox.json"),
  ];
  if (repoRoot && repoRoot !== worktreePath) {
    candidates.push(pathJoin(repoRoot, "macbox.json"));
  }

  for (const p of candidates) {
    try {
      const txt = await Deno.readTextFile(p);
      const raw = JSON.parse(txt);
      return validateConfig(raw);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      if (e instanceof SyntaxError) {
        throw new Error(`macbox.json: invalid JSON in ${p}: ${e.message}`);
      }
      throw e;
    }
  }

  return null;
};

export const emptyConfig = (): MacboxConfig => ({
  schema: "macbox.config.v1",
});
