import type { StepDef } from "./flow_config.ts";
import { exec, mustExec } from "./exec.ts";
import { executeSandboxRun, type SandboxRunRequest } from "./sandbox_run.ts";
import { loadSkillByName, expandSkill } from "./skills.ts";
import type { AgentKind } from "./agent.ts";
import { defaultAgentCmd } from "./agent.ts";
import type { SessionCaps } from "./sessions.ts";
import { ghExec } from "./gh.ts";
import { pathJoin } from "./os.ts";

export type StepContext = {
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly caps?: Partial<SessionCaps>;
  readonly env?: Record<string, string>;
  readonly previousResults: ReadonlyArray<StepResult>;
  readonly debug: boolean;
};

export type StepResult = {
  readonly stepId: string;
  readonly type: string;
  readonly label?: string;
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly error?: string;
  readonly skipped?: boolean;
  readonly outputs: Readonly<Record<string, string>>;
};

const isoNow = () => new Date().toISOString();

type StepHandler = (step: StepDef, ctx: StepContext) => Promise<StepResult>;

const wrapResult = (
  step: StepDef,
  startedAt: string,
  result: { code: number; stdout?: string; stderr?: string },
  extraOutputs?: Record<string, string>,
): StepResult => ({
  stepId: step.id,
  type: step.type,
  label: step.label,
  exitCode: result.code,
  stdout: result.stdout,
  stderr: result.stderr,
  startedAt,
  completedAt: isoNow(),
  outputs: { result: result.stdout?.trim() ?? "", ...extraOutputs },
});

const wrapError = (step: StepDef, startedAt: string, err: unknown): StepResult => ({
  stepId: step.id,
  type: step.type,
  label: step.label,
  exitCode: 1,
  error: err instanceof Error ? err.message : String(err),
  startedAt,
  completedAt: isoNow(),
  outputs: {},
});

// --- Built-in step handlers ---

const shellStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const cmd = step.args?.cmd;
  if (typeof cmd !== "string" || !cmd) {
    return wrapError(step, startedAt, "steps:shell requires args.cmd (string)");
  }

  try {
    const result = await exec(["bash", "-lc", cmd], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitDiffStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  try {
    const result = await exec(["git", "diff"], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitStatusStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  try {
    const result = await exec(["git", "status", "--porcelain"], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitCheckoutStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const branch = step.args?.branch;
  if (typeof branch !== "string" || !branch) {
    return wrapError(step, startedAt, "steps:git.checkout requires args.branch (string)");
  }
  try {
    const result = await exec(["git", "checkout", branch], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitPullStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  try {
    const result = await exec(["git", "pull"], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitCommitStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const message = step.args?.message;
  if (typeof message !== "string" || !message) {
    return wrapError(step, startedAt, "steps:git.commit requires args.message (string)");
  }
  try {
    const addAll = step.args?.all === true;
    if (addAll) {
      await exec(["git", "add", "-A"], { cwd: ctx.worktreePath });
    }
    const result = await exec(["git", "commit", "-m", message], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitFetchStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  try {
    const result = await exec(["git", "fetch"], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitMergeStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const branch = step.args?.branch;
  if (typeof branch !== "string" || !branch) {
    return wrapError(step, startedAt, "steps:git.merge requires args.branch (string)");
  }
  try {
    const result = await exec(["git", "merge", branch], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitConflictListStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  try {
    const result = await exec(["git", "diff", "--name-only", "--diff-filter=U"], { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const gitAddStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const files = step.args?.files;
  try {
    const cmd = Array.isArray(files) && files.every((f) => typeof f === "string")
      ? ["git", "add", ...files as string[]]
      : ["git", "add", "-A"];
    const result = await exec(cmd, { cwd: ctx.worktreePath });
    return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const agentRunStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const agent = ctx.agent;
  if (!agent || agent === "custom") {
    return wrapError(step, startedAt, "steps:agent.run requires a configured agent (claude or codex)");
  }

  const baseCmd = [...defaultAgentCmd(agent, true)];
  const passthrough = step.args?.passthrough;
  const cmd = Array.isArray(passthrough)
    ? [...baseCmd, ...passthrough.filter((x) => typeof x === "string") as string[]]
    : baseCmd;

  try {
    const result = await executeSandboxRun({
      worktreePath: ctx.worktreePath,
      repoRoot: ctx.repoRoot,
      gitCommonDir: ctx.gitCommonDir,
      gitDir: ctx.gitDir,
      agent,
      profiles: ctx.profiles,
      caps: ctx.caps,
      command: cmd,
      env: ctx.env,
      debug: ctx.debug,
      capture: true,
    });
    return wrapResult(step, startedAt, result);
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

const skillStep = async (
  skillName: string,
  step: StepDef,
  ctx: StepContext,
): Promise<StepResult> => {
  const startedAt = isoNow();
  try {
    const skill = await loadSkillByName(ctx.worktreePath, skillName);
    const expanded = expandSkill(skill, ctx.worktreePath);
    const skillArgs = step.args?.skillArgs;
    const cmd = Array.isArray(skillArgs)
      ? [...expanded.command, ...skillArgs.filter((x) => typeof x === "string") as string[]]
      : expanded.command;

    const result = await executeSandboxRun({
      worktreePath: ctx.worktreePath,
      repoRoot: ctx.repoRoot,
      gitCommonDir: ctx.gitCommonDir,
      gitDir: ctx.gitDir,
      agent: ctx.agent,
      profiles: ctx.profiles,
      caps: ctx.caps,
      command: [...cmd],
      env: { ...ctx.env, ...expanded.env },
      debug: ctx.debug,
      capture: true,
    });
    return wrapResult(step, startedAt, result);
  } catch (err) {
    return wrapError(step, startedAt, err);
  }
};

// --- Output helpers ---

const parseJsonOutputs = (
  stdout: string | undefined,
  keys: ReadonlyArray<string>,
): Record<string, string> => {
  if (!stdout) return {};
  try {
    const parsed = JSON.parse(stdout.trim());
    const out: Record<string, string> = {};
    for (const key of keys) {
      if (parsed[key] !== undefined && parsed[key] !== null) {
        out[key] = String(parsed[key]);
      }
    }
    return out;
  } catch {
    return {};
  }
};

// --- GitHub steps ---

const ghIssueGetStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const number = step.args?.number;
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return wrapError(step, startedAt, "steps:gh.issueGet requires args.number (integer)");
  }
  const result = await ghExec(
    ["issue", "view", String(number), "--json", "title,body,labels,assignees,state,url"],
    ctx.worktreePath,
  );
  const extra = parseJsonOutputs(result.stdout, ["title", "body", "url", "state"]);
  return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr }, extra);
};

const ghPrGetStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const number = step.args?.number;
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return wrapError(step, startedAt, "steps:gh.prGet requires args.number (integer)");
  }
  const result = await ghExec(
    ["pr", "view", String(number), "--json", "title,body,labels,assignees,state,url,headRefName,baseRefName"],
    ctx.worktreePath,
  );
  const extra = parseJsonOutputs(result.stdout, ["title", "body", "url", "state", "headRefName", "baseRefName"]);
  return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr }, extra);
};

const ghPrCreateStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const title = step.args?.title;
  const body = step.args?.body;
  if (typeof title !== "string" || !title) {
    return wrapError(step, startedAt, "steps:gh.prCreate requires args.title (string)");
  }
  const args = ["pr", "create", "--title", title];
  if (typeof body === "string") args.push("--body", body);
  if (typeof step.args?.base === "string") args.push("--base", step.args.base as string);
  if (typeof step.args?.head === "string") args.push("--head", step.args.head as string);
  const result = await ghExec(args, ctx.worktreePath);
  const url = result.stdout?.trim() ?? "";
  return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr }, url ? { url } : undefined);
};

const ghPrMergeStep: StepHandler = async (step, ctx) => {
  const startedAt = isoNow();
  const number = step.args?.number;
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return wrapError(step, startedAt, "steps:gh.prMerge requires args.number (integer)");
  }
  const method = typeof step.args?.method === "string" ? step.args.method as string : "merge";
  const args = ["pr", "merge", String(number), `--${method}`];
  const result = await ghExec(args, ctx.worktreePath);
  return wrapResult(step, startedAt, { code: result.code, stdout: result.stdout, stderr: result.stderr });
};

// --- Step dispatcher ---

const builtinHandlers: Record<string, StepHandler> = {
  "steps:shell": shellStep,
  "steps:git.diff": gitDiffStep,
  "steps:git.status": gitStatusStep,
  "steps:git.checkout": gitCheckoutStep,
  "steps:git.pull": gitPullStep,
  "steps:git.commit": gitCommitStep,
  "steps:git.fetch": gitFetchStep,
  "steps:git.merge": gitMergeStep,
  "steps:git.conflictList": gitConflictListStep,
  "steps:git.add": gitAddStep,
  "steps:agent.run": agentRunStep,
  "steps:gh.issueGet": ghIssueGetStep,
  "steps:gh.prGet": ghPrGetStep,
  "steps:gh.prCreate": ghPrCreateStep,
  "steps:gh.prMerge": ghPrMergeStep,
};

export const executeStep = async (
  step: StepDef,
  ctx: StepContext,
): Promise<StepResult> => {
  // Check for skills:<name> prefix
  if (step.type.startsWith("skills:")) {
    const skillName = step.type.slice("skills:".length);
    return await skillStep(skillName, step, ctx);
  }

  const handler = builtinHandlers[step.type];
  if (!handler) {
    return {
      stepId: step.id,
      type: step.type,
      label: step.label,
      exitCode: 1,
      error: `unknown step type: ${step.type}`,
      startedAt: isoNow(),
      completedAt: isoNow(),
      outputs: {},
    };
  }

  return await handler(step, ctx);
};
