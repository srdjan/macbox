// Ralph autonomous loop engine.
// Decoupled from CLI so both `macbox ralph` and `steps:ralph.run` can call it.
//
// The loop is structured as a stateless reducer dispatch:
//   while (true) { intent = determineNextStep(thread); execute(intent); persist(thread); }

import type {
  GateResult,
  IterationResult,
  MultiAgentConfig,
  MultiAgentPhase,
  Prd,
  QualityGate,
  RalphConfig,
  RalphState,
  Story,
  TerminationReason,
} from "./ralph_types.ts";
import { defaultRalphConfig, PHASE_ORDER, PHASE_TO_ROLE } from "./ralph_types.ts";
import { exec } from "./exec.ts";
import { executeSandboxRun, type SandboxRunRequest } from "./sandbox_run.ts";
import { defaultAgentCmd, type AgentKind } from "./agent.ts";
import type { SessionCaps } from "./sessions.ts";
import { ensureDir } from "./fs.ts";
import { pathJoin } from "./os.ts";
import type { RalphThread, RalphEvent } from "./ralph_thread.ts";
import {
  appendEvent,
  createThread,
  mkEvent,
  persistThread,
  loadThread,
  serializeForPrompt,
  threadToPrd,
  threadToProgress,
  threadToState,
} from "./ralph_thread.ts";
import { determineNextStep, type PhasePromptFn, type RalphIntent } from "./ralph_reducer.ts";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const isoNow = () => new Date().toISOString();

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** Select the highest-priority incomplete story, or null if all pass. */
export const selectNextStory = (prd: Prd): Story | null => {
  const incomplete = prd.userStories.filter((s) => !s.passes);
  if (incomplete.length === 0) return null;
  return incomplete.reduce((best, s) => (s.priority < best.priority ? s : best));
};

/** Check whether agent output contains the completion signal. */
export const detectCompletionSignal = (output: string): boolean =>
  output.includes("<promise>COMPLETE</promise>");

/** Generate a single-story PRD from a free-form prompt string. */
export const promptToPrd = (prompt: string): Prd => ({
  project: "ad-hoc",
  description: prompt,
  userStories: [{
    id: "US-001",
    title: prompt.length > 80 ? prompt.slice(0, 77) + "..." : prompt,
    description: prompt,
    acceptanceCriteria: ["Implementation matches the prompt requirements"],
    priority: 1,
    passes: false,
  }],
});

/** Validate a raw object as a Prd. */
export const validatePrd = (raw: unknown): Prd => {
  if (!isObj(raw)) throw new Error("prd must be an object");
  const project = typeof raw.project === "string" ? raw.project : "unknown";
  const description = typeof raw.description === "string" ? raw.description : "";
  const stories = Array.isArray(raw.userStories) ? raw.userStories : [];
  if (stories.length === 0) throw new Error("prd.userStories must be a non-empty array");

  const userStories: Story[] = stories.map((s: unknown, i: number) => {
    if (!isObj(s)) throw new Error(`prd.userStories[${i}] must be an object`);
    const id = typeof s.id === "string" ? s.id : `US-${String(i + 1).padStart(3, "0")}`;
    const title = typeof s.title === "string" ? s.title : "";
    const desc = typeof s.description === "string" ? s.description : title;
    const ac = Array.isArray(s.acceptanceCriteria)
      ? (s.acceptanceCriteria as unknown[]).filter((x) => typeof x === "string") as string[]
      : [];
    const priority = typeof s.priority === "number" ? s.priority : i + 1;
    const passes = typeof s.passes === "boolean" ? s.passes : false;
    const notes = typeof s.notes === "string" ? s.notes : undefined;
    if (!title) throw new Error(`prd.userStories[${i}] missing title`);
    return { id, title, description: desc, acceptanceCriteria: ac, priority, passes, notes };
  });

  return { project, description, userStories };
};

/** Parse and merge user config with defaults. */
export const parseRalphConfig = (raw: unknown): RalphConfig => {
  if (!raw || !isObj(raw)) return { ...defaultRalphConfig };
  const maxIterations = typeof raw.maxIterations === "number" && raw.maxIterations > 0
    ? raw.maxIterations
    : defaultRalphConfig.maxIterations;
  const delay = typeof raw.delayBetweenIterationsMs === "number"
    ? raw.delayBetweenIterationsMs
    : defaultRalphConfig.delayBetweenIterationsMs;
  const commitOnPass = typeof raw.commitOnPass === "boolean"
    ? raw.commitOnPass
    : defaultRalphConfig.commitOnPass;
  const promptTemplate = typeof raw.promptTemplate === "string"
    ? raw.promptTemplate
    : undefined;
  const requireApprovalBeforeCommit = typeof raw.requireApprovalBeforeCommit === "boolean"
    ? raw.requireApprovalBeforeCommit
    : undefined;
  const maxConsecutiveFailures = typeof raw.maxConsecutiveFailures === "number" && raw.maxConsecutiveFailures > 0
    ? raw.maxConsecutiveFailures
    : undefined;

  const qualityGates: QualityGate[] = [];
  if (Array.isArray(raw.qualityGates)) {
    for (const g of raw.qualityGates) {
      if (isObj(g) && typeof g.name === "string" && typeof g.cmd === "string") {
        qualityGates.push({
          name: g.name,
          cmd: g.cmd,
          continueOnFail: typeof g.continueOnFail === "boolean" ? g.continueOnFail : undefined,
        });
      }
    }
  }

  // Parse multi-agent config if present
  const rawMulti = isObj(raw.multiAgent) ? raw.multiAgent : undefined;
  const multiAgent: MultiAgentConfig | undefined = rawMulti && rawMulti.enabled
    ? {
        enabled: true,
        agentA: (typeof rawMulti.agentA === "string" && isAgentKind(rawMulti.agentA)) ? rawMulti.agentA : "claude",
        agentB: (typeof rawMulti.agentB === "string" && isAgentKind(rawMulti.agentB)) ? rawMulti.agentB : "codex",
        cmdA: typeof rawMulti.cmdA === "string" ? rawMulti.cmdA : undefined,
        cmdB: typeof rawMulti.cmdB === "string" ? rawMulti.cmdB : undefined,
      }
    : undefined;

  return {
    maxIterations,
    qualityGates,
    delayBetweenIterationsMs: delay,
    commitOnPass,
    promptTemplate,
    requireApprovalBeforeCommit,
    maxConsecutiveFailures,
    multiAgent,
  };
};

const isAgentKind = (v: string): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

/** Build the per-iteration prompt sent to the agent (legacy signature for backward compat). */
export const buildPrompt = (
  prd: Prd,
  story: Story,
  progress: string,
  iteration: number,
  config: RalphConfig,
): string => {
  const totalStories = prd.userStories.length;
  const passedCount = prd.userStories.filter((s) => s.passes).length;
  const remaining = prd.userStories
    .filter((s) => !s.passes)
    .sort((a, b) => a.priority - b.priority)
    .map((s) => `  - [${s.id}] (priority ${s.priority}) ${s.title}`)
    .join("\n");

  const acList = story.acceptanceCriteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  const gateList = config.qualityGates.length > 0
    ? config.qualityGates.map((g) => `  - ${g.name}: ${g.cmd}`).join("\n")
    : "  (none configured)";

  const notesSection = story.notes ? `\nNotes: ${story.notes}\n` : "";

  const progressSection = progress.trim().length > 0
    ? progress.trim()
    : "No previous iterations.";

  return `You are an autonomous coding agent working on: ${prd.project}
Project description: ${prd.description}

== Current Story ==
ID: ${story.id}
Title: ${story.title}
Description: ${story.description}
Acceptance Criteria:
${acList}
${notesSection}
== PRD Overview ==
Stories completed: ${passedCount}/${totalStories}
Remaining stories (by priority):
${remaining}

== Progress from Previous Iterations ==
${progressSection}

== Instructions ==
1. Implement ONLY the current story (${story.id}).
2. Make minimal, focused changes. Follow existing code patterns.
3. After implementation, the following quality gates will run automatically:
${gateList}
4. Do NOT commit. The system handles commits after quality gates pass.
5. If you discover reusable patterns or gotchas, note them clearly in your output.
6. If ALL project stories are complete, output exactly: <promise>COMPLETE</promise>

This is iteration ${iteration} of ${config.maxIterations}.`;
};

// ---------------------------------------------------------------------------
// Structured prompt construction (Thread-based)
// ---------------------------------------------------------------------------

/** Build the per-iteration prompt from Thread state using XML sections. */
export const buildPromptFromThread = (
  thread: RalphThread,
  story: Story,
  iteration: number,
  config: RalphConfig,
): string => {
  const prd = threadToPrd(thread);
  const totalStories = prd.userStories.length;
  const passedCount = prd.userStories.filter((s) => s.passes).length;
  const remaining = prd.userStories
    .filter((s) => !s.passes)
    .sort((a, b) => a.priority - b.priority)
    .map((s) => `  [${s.id}] (priority ${s.priority}) ${s.title}`)
    .join("\n  ");

  const acList = story.acceptanceCriteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  const gateList = config.qualityGates.length > 0
    ? config.qualityGates.map((g) => `  - ${g.name}: ${g.cmd}`).join("\n")
    : "  (none configured)";

  const notesSection = story.notes ? `\nNotes: ${story.notes}` : "";

  const executionHistory = serializeForPrompt(thread);

  return `You are an autonomous coding agent working on: ${prd.project}
Project description: ${prd.description}

<current-story>
ID: ${story.id}
Title: ${story.title}
Description: ${story.description}
Acceptance Criteria:
${acList}${notesSection}
</current-story>

<prd-overview>
Stories completed: ${passedCount}/${totalStories}
Remaining stories (by priority):
  ${remaining}
</prd-overview>

${executionHistory}

<quality-gates>
${gateList}
</quality-gates>

<instructions>
1. Implement ONLY the current story (${story.id}).
2. Make minimal, focused changes. Follow existing code patterns.
3. After implementation, the following quality gates will run automatically.
4. Do NOT commit. The system handles commits after quality gates pass.
5. If you discover reusable patterns or gotchas, note them clearly in your output.
6. If ALL project stories are complete, output exactly: <promise>COMPLETE</promise>
7. If you need human input, output: <request-input>reason</request-input>
</instructions>

This is iteration ${iteration} of ${config.maxIterations}.`;
};

// ---------------------------------------------------------------------------
// Multi-agent phase prompt construction
// ---------------------------------------------------------------------------

const PHASE_ROLE_DESCRIPTIONS: Record<MultiAgentPhase, string> = {
  brainstorm: "You are Agent-A in a multi-agent coding pipeline. Your role is to BRAINSTORM approaches for implementing this story. Do NOT write code yet.",
  clarify: "You are Agent-B reviewing a brainstorm from Agent-A. Your role is to CLARIFY by identifying gaps, asking questions, and refining the approach. Do NOT write code yet.",
  plan: "You are Agent-A creating a DETAILED IMPLEMENTATION PLAN. You have your brainstorm and Agent-B's review. Produce a step-by-step plan that Agent-B will follow.",
  execute: "You are Agent-B implementing a plan created by Agent-A. Follow the plan precisely and write all necessary code.",
  aar: "You are Agent-A conducting an After Action Review of Agent-B's implementation. Review the code changes against the plan and acceptance criteria. Do NOT modify code.",
  incorporate_aar: "You are Agent-B refining your implementation based on Agent-A's After Action Review. Apply the fixes identified.",
};

const PHASE_INSTRUCTIONS: Record<MultiAgentPhase, string> = {
  brainstorm: `1. Analyze the story requirements and codebase structure
2. Identify 2-3 possible implementation approaches
3. For each approach, explain: strategy, files to modify, risks, and complexity
4. Recommend your preferred approach with reasoning
5. Note any ambiguities or questions that need clarification
6. Output your analysis in plain text (no code files yet)`,
  clarify: `1. Review Agent-A's proposed approaches critically
2. Identify any missed edge cases, architectural concerns, or ambiguities
3. Ask specific questions about unclear aspects
4. Suggest refinements to the recommended approach
5. If the brainstorm is solid, confirm and add supplementary considerations
6. Output your review in plain text (no code files yet)`,
  plan: `1. Address all questions and concerns raised in the clarification phase
2. Produce a numbered, step-by-step implementation plan
3. For each step, specify: file path, what to change, and why
4. Include test strategy
5. Be precise enough that another agent can execute without ambiguity
6. Do NOT write the actual code - describe what code to write`,
  execute: `1. Follow the implementation plan step by step
2. Write all necessary code changes
3. If the plan has ambiguities, use your best judgment and note deviations
4. Make minimal, focused changes following existing code patterns
5. Do NOT commit - the system handles commits
6. Summarize what you changed and any deviations from the plan`,
  aar: `1. Review the code changes against the plan and acceptance criteria
2. Identify any issues: bugs, missed requirements, style violations, test gaps
3. For each issue, describe: what is wrong, where, and how to fix it
4. If the implementation looks correct, confirm with a brief summary
5. Be specific and actionable - Agent-B will use this to refine
6. Do NOT modify code - only review and describe issues`,
  incorporate_aar: `1. Address each issue identified in the AAR
2. Apply fixes to the codebase
3. If the AAR found no issues, confirm the implementation is complete
4. Make minimal changes - only fix what was identified
5. Do NOT commit - the system handles commits
6. Summarize all changes made in response to the AAR`,
};

const MAX_PHASE_OUTPUT_CHARS = 8000;

const truncatePhaseOutput = (output: string): string =>
  output.length > MAX_PHASE_OUTPUT_CHARS
    ? output.slice(-MAX_PHASE_OUTPUT_CHARS) + "\n[...truncated]"
    : output;

/** Build a phase-specific prompt for multi-agent mode. */
export const buildPhasePrompt: PhasePromptFn = (
  prd: Prd,
  story: Story,
  iteration: number,
  phase: MultiAgentPhase,
  priorPhaseOutputs: ReadonlyArray<{ phase: MultiAgentPhase; output: string }>,
): string => {
  const totalStories = prd.userStories.length;
  const passedCount = prd.userStories.filter((s) => s.passes).length;
  const remaining = prd.userStories
    .filter((s) => !s.passes)
    .sort((a, b) => a.priority - b.priority)
    .map((s) => `  [${s.id}] (priority ${s.priority}) ${s.title}`)
    .join("\n  ");

  const acList = story.acceptanceCriteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  const notesSection = story.notes ? `\nNotes: ${story.notes}` : "";

  const roleDescription = PHASE_ROLE_DESCRIPTIONS[phase];
  const phaseInstructions = PHASE_INSTRUCTIONS[phase];

  const priorContext = priorPhaseOutputs.length > 0
    ? priorPhaseOutputs.map((p) =>
        `<phase-output phase="${p.phase}">\n${truncatePhaseOutput(p.output)}\n</phase-output>`
      ).join("\n\n")
    : "";

  return `${roleDescription}

Project: ${prd.project}
Description: ${prd.description}

<current-story>
ID: ${story.id}
Title: ${story.title}
Description: ${story.description}
Acceptance Criteria:
${acList}${notesSection}
</current-story>

<prd-overview>
Stories completed: ${passedCount}/${totalStories}
Remaining stories (by priority):
  ${remaining}
</prd-overview>

${priorContext ? `<prior-phases>\n${priorContext}\n</prior-phases>` : ""}

<instructions>
${phaseInstructions}
</instructions>

This is phase "${phase}" of iteration ${iteration}.`;
};

// ---------------------------------------------------------------------------
// Multi-agent agent command resolution
// ---------------------------------------------------------------------------

/** Resolve the base command for a specific agent role in multi-agent mode. */
const resolvePhaseAgentCommand = (
  phaseAgent: AgentKind,
  multiConfig: MultiAgentConfig,
): ReadonlyArray<string> => {
  if (phaseAgent === multiConfig.agentA && multiConfig.cmdA) {
    return [multiConfig.cmdA];
  }
  if (phaseAgent === multiConfig.agentB && multiConfig.cmdB) {
    return [multiConfig.cmdB];
  }
  return defaultAgentCmd(phaseAgent, true);
};

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/** Load and validate a prd.json file. */
export const loadPrdFromFile = async (path: string): Promise<Prd> => {
  const text = await Deno.readTextFile(path);
  const raw = JSON.parse(text);
  return validatePrd(raw);
};

const readProgressFile = async (ralphDir: string): Promise<string> => {
  try {
    return await Deno.readTextFile(pathJoin(ralphDir, "progress.txt"));
  } catch {
    return "";
  }
};

const appendProgressFile = async (
  ralphDir: string,
  iteration: number,
  story: Story,
  gateResults: ReadonlyArray<GateResult>,
  committed: boolean,
) => {
  const gateSummary = gateResults.length > 0
    ? gateResults.map((g) => `${g.name}: ${g.passed ? "PASS" : "FAIL"}`).join(", ")
    : "no gates";
  const entry = `## Iteration ${iteration} - ${isoNow()}
Story: ${story.id} - ${story.title}
Gates: ${gateSummary}
Committed: ${committed ? "yes" : "no"}
---
`;
  const file = pathJoin(ralphDir, "progress.txt");
  await Deno.writeTextFile(file, entry, { append: true, create: true });
};

const persistState = async (ralphDir: string, state: RalphState) => {
  const file = pathJoin(ralphDir, "state.json");
  await Deno.writeTextFile(file, JSON.stringify(state, null, 2) + "\n", { create: true });
};

/** Update a single story's passes field in the prd.json file. */
const updatePrdFile = async (prdPath: string, storyId: string): Promise<Prd> => {
  const text = await Deno.readTextFile(prdPath);
  const raw = JSON.parse(text);
  if (Array.isArray(raw.userStories)) {
    for (const s of raw.userStories) {
      if (isObj(s) && s.id === storyId) {
        (s as Record<string, unknown>).passes = true;
      }
    }
  }
  await Deno.writeTextFile(prdPath, JSON.stringify(raw, null, 2) + "\n");
  return validatePrd(raw);
};

const allStoriesPassed = (prd: Prd): boolean =>
  prd.userStories.every((s) => s.passes);

const truncateProgress = (progress: string, maxEntries: number): string => {
  const entries = progress.split(/^---$/m).filter((e) => e.trim().length > 0);
  if (entries.length <= maxEntries) return progress;
  const kept = entries.slice(-maxEntries);
  return `[${entries.length - maxEntries} earlier iteration(s) omitted]\n---\n${kept.join("---\n")}---\n`;
};

// ---------------------------------------------------------------------------
// Extracted side-effect functions
// ---------------------------------------------------------------------------

type AgentExecResult = { code: number; stdout?: string; stderr?: string };

/** Execute the agent inside the sandbox. */
export const executeAgentInSandbox = async (
  args: {
    baseCommand: ReadonlyArray<string>;
    prompt: string;
    worktreePath: string;
    repoRoot: string;
    gitCommonDir: string;
    gitDir: string;
    agent: AgentKind;
    profiles?: ReadonlyArray<string>;
    caps?: Partial<SessionCaps>;
    env: Record<string, string>;
    debug?: boolean;
  },
): Promise<AgentExecResult> => {
  const agentCmd = [...args.baseCommand, args.prompt];
  return await executeSandboxRun({
    worktreePath: args.worktreePath,
    repoRoot: args.repoRoot,
    gitCommonDir: args.gitCommonDir,
    gitDir: args.gitDir,
    agent: args.agent,
    profiles: args.profiles,
    caps: args.caps,
    command: agentCmd,
    env: args.env,
    debug: args.debug,
    capture: true,
    stream: true,
  });
};

/** Execute a quality gate command in the worktree. */
export const executeQualityGate = async (
  gate: QualityGate,
  worktreePath: string,
): Promise<GateResult> => {
  const gResult = await exec(["bash", "-lc", gate.cmd], { cwd: worktreePath });
  return {
    name: gate.name,
    exitCode: gResult.code,
    stdout: gResult.stdout,
    stderr: gResult.stderr,
    passed: gResult.code === 0,
  };
};

/** Execute git commit in the worktree. */
export const executeCommit = async (
  worktreePath: string,
  storyId: string,
  storyTitle: string,
  prdPath: string,
): Promise<{ success: boolean; message: string }> => {
  await exec(["git", "add", "-A"], { cwd: worktreePath });
  const commitMsg = `feat: ${storyId} - ${storyTitle}`;
  const commitResult = await exec(["git", "commit", "-m", commitMsg, "--allow-empty"], {
    cwd: worktreePath,
  });
  if (commitResult.code !== 0) {
    return { success: false, message: commitResult.stderr ?? "commit failed" };
  }
  // Commit the updated prd.json too (will be updated by caller)
  await exec(["git", "add", prdPath], { cwd: worktreePath });
  await exec(["git", "commit", "-m", `chore: mark ${storyId} as passed`], {
    cwd: worktreePath,
  });
  return { success: true, message: "committed" };
};

// ---------------------------------------------------------------------------
// Core loop (reducer dispatch)
// ---------------------------------------------------------------------------

export type RalphRunArgs = {
  readonly prd: Prd;
  readonly prdPath?: string;
  readonly config: RalphConfig;
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent: AgentKind;
  readonly command?: ReadonlyArray<string>;
  readonly profiles?: ReadonlyArray<string>;
  readonly caps?: Partial<SessionCaps>;
  readonly env?: Record<string, string>;
  readonly debug?: boolean;
};

/** Signal set by SIGINT handler to pause the loop. */
let pauseRequested = false;

export const requestPause = () => { pauseRequested = true; };
export const clearPause = () => { pauseRequested = false; };

/** Run the reducer dispatch loop from a given Thread. */
const runLoop = async (
  thread: RalphThread,
  args: RalphRunArgs,
): Promise<RalphState> => {
  const { config, worktreePath, repoRoot, gitCommonDir, gitDir, agent, debug } = args;
  const ralphDir = pathJoin(worktreePath, ".macbox", "ralph");
  await ensureDir(ralphDir);

  const baseCommand = args.command ?? defaultAgentCmd(agent, true);
  if (baseCommand.length === 0) {
    throw new Error("ralph: no agent command configured (use --agent or --cmd)");
  }

  const prdPath = args.prdPath ?? pathJoin(worktreePath, "prd.json");
  // Write the working copy of prd.json if it does not exist at the expected location
  try {
    await Deno.stat(prdPath);
  } catch {
    const prd = threadToPrd(thread);
    await Deno.writeTextFile(prdPath, JSON.stringify(prd, null, 2) + "\n", { create: true });
  }

  // Build the prompt function for the reducer
  const buildPromptFn = (prd: Prd, story: Story, iteration: number): string => {
    if (config.promptTemplate) return config.promptTemplate;
    return buildPromptFromThread(thread, story, iteration, config);
  };

  // Phase prompt builder for multi-agent mode (always provided; reducer checks config)
  const buildPhasePromptFn: PhasePromptFn = buildPhasePrompt;

  // Tracking for backward-compat derived state
  let currentStory: Story | null = null;
  let iterationGateResults: GateResult[] = [];
  let iterationCommitted = false;

  while (true) {
    // Check for pause between iterations
    if (pauseRequested) {
      pauseRequested = false;
      thread = appendEvent(thread, mkEvent("thread_completed", { reason: "paused" }));
      await persistThread(ralphDir, thread);
      break;
    }

    const intent = determineNextStep(thread, config, buildPromptFn, buildPhasePromptFn);

    switch (intent.kind) {
      // -------------------------------------------------------------------
      case "run_agent": {
        const { story, prompt, iteration, phase, role, agent: phaseAgent } = intent;

        // Multi-agent phase dispatch
        if (phase && phaseAgent && config.multiAgent?.enabled) {
          // Emit iteration_started if not already emitted for this iteration
          const lastIterStart = thread.events.findLast((e) => e.type === "iteration_started");
          const needsIterStart = !lastIterStart ||
            (lastIterStart.data.iteration as number) !== iteration;

          if (needsIterStart) {
            currentStory = story;
            iterationGateResults = [];
            iterationCommitted = false;

            console.error(
              `ralph: iteration ${iteration}/${config.maxIterations} - story ${story.id}: ${story.title}`,
            );
            thread = appendEvent(thread, mkEvent("iteration_started", {
              iteration,
              storyId: story.id,
              storyTitle: story.title,
            }));
          }

          console.error(`ralph:   phase ${phase} (${phaseAgent})`);

          // Emit phase_started
          thread = appendEvent(thread, mkEvent("phase_started", {
            phase,
            role,
            agent: phaseAgent,
            storyId: story.id,
            iteration,
          }));

          // Resolve command for this agent
          const phaseBaseCommand = resolvePhaseAgentCommand(phaseAgent, config.multiAgent);

          // Build sandbox env
          const env: Record<string, string> = { ...(args.env ?? {}) };
          env["MACBOX_RALPH_ITERATION"] = String(iteration);
          env["MACBOX_RALPH_STORY_ID"] = story.id;
          env["MACBOX_RALPH_MAX_ITERATIONS"] = String(config.maxIterations);
          env["MACBOX_RALPH_PHASE"] = phase;
          env["MACBOX_RALPH_ROLE"] = role!;

          // Execute agent
          let agentResult: AgentExecResult;
          try {
            agentResult = await executeAgentInSandbox({
              baseCommand: phaseBaseCommand,
              prompt,
              worktreePath,
              repoRoot,
              gitCommonDir,
              gitDir,
              agent: phaseAgent,
              profiles: args.profiles,
              caps: args.caps,
              env,
              debug,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            thread = appendEvent(thread, mkEvent("error", {
              source: "phase_agent_invocation",
              message: msg,
              recoverable: true,
              phase,
            }));
            console.error(`ralph: phase ${phase} agent invocation failed: ${msg}`);
            agentResult = { code: 1, stdout: "", stderr: msg };
          }

          // Emit phase_completed
          thread = appendEvent(thread, mkEvent("phase_completed", {
            phase,
            role,
            agent: phaseAgent,
            storyId: story.id,
            iteration,
            exitCode: agentResult.code,
            stdout: agentResult.stdout,
            stderr: agentResult.stderr,
          }));

          // If execution phases fail, complete iteration as failed
          if (agentResult.code !== 0 && (phase === "execute" || phase === "incorporate_aar")) {
            console.error(`ralph: phase ${phase} failed (exit ${agentResult.code})`);
            thread = appendEvent(thread, mkEvent("iteration_completed", {
              iteration,
              storyId: story.id,
              allGatesPassed: false,
            }));

            if (currentStory) {
              await appendProgressFile(ralphDir, iteration, currentStory, [], false);
            }
            await persistState(ralphDir, threadToState(thread));
            await persistThread(ralphDir, thread);

            if (config.delayBetweenIterationsMs > 0) {
              await new Promise((r) => setTimeout(r, config.delayBetweenIterationsMs));
            }
            continue;
          }

          await persistThread(ralphDir, thread);
          continue;
        }

        // Single-agent path (unchanged)
        currentStory = story;
        iterationGateResults = [];
        iterationCommitted = false;

        console.error(
          `ralph: iteration ${iteration}/${config.maxIterations} - story ${story.id}: ${story.title}`,
        );

        // Append iteration_started
        thread = appendEvent(thread, mkEvent("iteration_started", {
          iteration,
          storyId: story.id,
          storyTitle: story.title,
        }));

        // Append agent_dispatched
        thread = appendEvent(thread, mkEvent("agent_dispatched", {
          storyId: story.id,
          iteration,
        }));

        // Build sandbox env
        const env: Record<string, string> = { ...(args.env ?? {}) };
        env["MACBOX_RALPH_ITERATION"] = String(iteration);
        env["MACBOX_RALPH_STORY_ID"] = story.id;
        env["MACBOX_RALPH_MAX_ITERATIONS"] = String(config.maxIterations);

        // Execute agent
        let agentResult: AgentExecResult;
        try {
          agentResult = await executeAgentInSandbox({
            baseCommand,
            prompt,
            worktreePath,
            repoRoot,
            gitCommonDir,
            gitDir,
            agent,
            profiles: args.profiles,
            caps: args.caps,
            env,
            debug,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          thread = appendEvent(thread, mkEvent("error", {
            source: "agent_invocation",
            message: msg,
            recoverable: true,
          }));
          console.error(`ralph: agent invocation failed: ${msg}`);
          agentResult = { code: 1, stdout: "", stderr: msg };
        }

        // Check for completion signal
        const completionSignal = detectCompletionSignal(agentResult.stdout ?? "");

        // Append agent_completed
        thread = appendEvent(thread, mkEvent("agent_completed", {
          storyId: story.id,
          exitCode: agentResult.code,
          stdout: agentResult.stdout,
          stderr: agentResult.stderr,
          completionSignal,
        }));

        // If agent failed (no gates to run), complete iteration
        if (agentResult.code !== 0 && !completionSignal) {
          console.error(`ralph: agent exited with code ${agentResult.code}`);
          thread = appendEvent(thread, mkEvent("iteration_completed", {
            iteration,
            storyId: story.id,
            allGatesPassed: false,
          }));

          // Write backward-compat files
          await appendProgressFile(ralphDir, iteration, story, [], false);
          await persistState(ralphDir, threadToState(thread));
          await persistThread(ralphDir, thread);

          // Delay before next iteration
          if (config.delayBetweenIterationsMs > 0) {
            await new Promise((r) => setTimeout(r, config.delayBetweenIterationsMs));
          }
          continue;
        }

        // If completion signal, complete iteration and break
        if (completionSignal) {
          thread = appendEvent(thread, mkEvent("iteration_completed", {
            iteration,
            storyId: story.id,
            allGatesPassed: true,
          }));
          thread = appendEvent(thread, mkEvent("thread_completed", {
            reason: "completion_signal",
          }));
          await appendProgressFile(ralphDir, iteration, story, [], false);
          await persistState(ralphDir, threadToState(thread));
          await persistThread(ralphDir, thread);
          break;
        }

        // Continue to let reducer decide next step (gates or commit)
        await persistThread(ralphDir, thread);
        continue;
      }

      // -------------------------------------------------------------------
      case "run_gate": {
        const { gate, storyId, gateIndex } = intent;

        thread = appendEvent(thread, mkEvent("gate_started", {
          storyId,
          gateName: gate.name,
          gateIndex,
        }));

        const result = await executeQualityGate(gate, worktreePath);
        iterationGateResults.push(result);

        thread = appendEvent(thread, mkEvent("gate_completed", {
          storyId,
          gateIndex,
          result,
        }));

        if (!result.passed) {
          console.error(`ralph: gate '${gate.name}' failed (exit ${result.exitCode})`);
          if (!gate.continueOnFail) {
            // Gate failed, non-continuable: complete the iteration as failed
            const iterEvent = thread.events.findLast((e) => e.type === "iteration_started");
            const iteration = (iterEvent?.data.iteration as number) ?? 1;
            thread = appendEvent(thread, mkEvent("iteration_completed", {
              iteration,
              storyId,
              allGatesPassed: false,
            }));

            if (currentStory) {
              await appendProgressFile(ralphDir, iteration, currentStory, iterationGateResults, false);
            }
            await persistState(ralphDir, threadToState(thread));
            await persistThread(ralphDir, thread);

            // Delay before next iteration
            if (config.delayBetweenIterationsMs > 0) {
              await new Promise((r) => setTimeout(r, config.delayBetweenIterationsMs));
            }
            continue;
          }
        }

        // Check if all gates done (reducer will handle more gates or proceed)
        await persistThread(ralphDir, thread);
        continue;
      }

      // -------------------------------------------------------------------
      case "commit": {
        const { storyId, storyTitle } = intent;

        try {
          const commitResult = await executeCommit(worktreePath, storyId, storyTitle, prdPath);
          if (commitResult.success) {
            iterationCommitted = true;
            await updatePrdFile(prdPath, storyId);
          } else {
            thread = appendEvent(thread, mkEvent("error", {
              source: "commit",
              message: commitResult.message,
              recoverable: true,
            }));
            console.error(`ralph: git commit failed: ${commitResult.message}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          thread = appendEvent(thread, mkEvent("error", {
            source: "commit",
            message: msg,
            recoverable: true,
          }));
          console.error(`ralph: commit error: ${msg}`);
        }

        thread = appendEvent(thread, mkEvent("commit_completed", {
          storyId,
          success: iterationCommitted,
        }));

        await persistThread(ralphDir, thread);
        continue;
      }

      // -------------------------------------------------------------------
      case "mark_passed": {
        const { storyId } = intent;

        // Update prd.json on disk if not yet done via commit path
        if (!iterationCommitted) {
          try {
            await updatePrdFile(prdPath, storyId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            thread = appendEvent(thread, mkEvent("error", {
              source: "mark_passed",
              message: msg,
              recoverable: true,
            }));
            console.error(`ralph: failed to update prd.json: ${msg}`);
          }
        }

        thread = appendEvent(thread, mkEvent("story_passed", { storyId }));

        // Complete the iteration
        const iterEvent = thread.events.findLast((e) => e.type === "iteration_started");
        const iteration = (iterEvent?.data.iteration as number) ?? 1;
        thread = appendEvent(thread, mkEvent("iteration_completed", {
          iteration,
          storyId,
          allGatesPassed: true,
        }));

        // Write backward-compat files
        if (currentStory) {
          await appendProgressFile(ralphDir, iteration, currentStory, iterationGateResults, iterationCommitted);
        }
        await persistState(ralphDir, threadToState(thread));
        await persistThread(ralphDir, thread);

        // Delay before next iteration
        if (config.delayBetweenIterationsMs > 0) {
          await new Promise((r) => setTimeout(r, config.delayBetweenIterationsMs));
        }
        continue;
      }

      // -------------------------------------------------------------------
      case "request_human_input": {
        const { reason, context } = intent;
        thread = appendEvent(thread, mkEvent("human_input_requested", { reason, context }));
        thread = appendEvent(thread, mkEvent("thread_completed", { reason: "human_input" }));
        await persistThread(ralphDir, thread);
        await persistState(ralphDir, threadToState(thread));
        break;
      }

      // -------------------------------------------------------------------
      case "complete": {
        const { reason } = intent;
        // Only append thread_completed if not already present
        const lastEv = thread.events.at(-1);
        if (!lastEv || lastEv.type !== "thread_completed") {
          thread = appendEvent(thread, mkEvent("thread_completed", { reason }));
        }
        await persistThread(ralphDir, thread);
        break;
      }

      // -------------------------------------------------------------------
      case "wait_delay": {
        // This should not normally be reached in the dispatch loop.
        // Safety: small delay to prevent busy-wait.
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
    }

    // If we reach here (non-continue cases: complete, request_human_input), break
    break;
  }

  const finalState = threadToState(thread);
  await persistState(ralphDir, finalState);

  // Print summary
  const prd = threadToPrd(thread);
  const passed = prd.userStories.filter((s) => s.passes).length;
  const total = prd.userStories.length;
  const iterations = finalState.iterations.length;
  console.error(
    `ralph: done - ${finalState.terminationReason} (${iterations} iterations, ${passed}/${total} stories passed)`,
  );

  return finalState;
};

/** Start a new Ralph loop from scratch. */
export const runRalphLoop = async (args: RalphRunArgs): Promise<RalphState> => {
  const thread = createThread(args.prd, args.config, {
    worktreePath: args.worktreePath,
    agent: args.agent,
  });
  return runLoop(thread, args);
};

/** Resume an existing Ralph loop from a persisted Thread. */
export const resumeRalphLoop = async (args: RalphRunArgs): Promise<RalphState> => {
  const ralphDir = pathJoin(args.worktreePath, ".macbox", "ralph");
  const thread = await loadThread(ralphDir);
  if (!thread) {
    throw new Error("ralph: no thread.json found to resume from");
  }

  // If thread is already completed, return the derived state
  const lastEv = thread.events.at(-1);
  if (lastEv?.type === "thread_completed") {
    return threadToState(thread);
  }

  return runLoop(thread, args);
};
