// Ralph autonomous loop engine.
// Decoupled from CLI so both `macbox ralph` and `steps:ralph.run` can call it.

import type {
  GateResult,
  IterationResult,
  Prd,
  QualityGate,
  RalphConfig,
  RalphState,
  Story,
  TerminationReason,
} from "./ralph_types.ts";
import { defaultRalphConfig } from "./ralph_types.ts";
import { exec } from "./exec.ts";
import { executeSandboxRun, type SandboxRunRequest } from "./sandbox_run.ts";
import { defaultAgentCmd, type AgentKind } from "./agent.ts";
import type { SessionCaps } from "./sessions.ts";
import { ensureDir } from "./fs.ts";
import { pathJoin } from "./os.ts";

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

  return { maxIterations, qualityGates, delayBetweenIterationsMs: delay, commitOnPass, promptTemplate };
};

/** Build the per-iteration prompt sent to the agent. */
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

const appendProgress = async (
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
// Core loop
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

export const runRalphLoop = async (args: RalphRunArgs): Promise<RalphState> => {
  const { config, worktreePath, repoRoot, gitCommonDir, gitDir, agent, debug } = args;
  const ralphDir = pathJoin(worktreePath, ".macbox", "ralph");
  await ensureDir(ralphDir);

  const baseCommand = args.command ?? defaultAgentCmd(agent);
  if (baseCommand.length === 0) {
    throw new Error("ralph: no agent command configured (use --agent or --cmd)");
  }

  let prd = args.prd;
  const prdPath = args.prdPath ?? pathJoin(worktreePath, "prd.json");
  // Write the working copy of prd.json if it does not exist at the expected location
  try {
    await Deno.stat(prdPath);
  } catch {
    await Deno.writeTextFile(prdPath, JSON.stringify(prd, null, 2) + "\n", { create: true });
  }

  const iterations: IterationResult[] = [];
  let terminationReason: TerminationReason = "running";
  const startedAt = isoNow();

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    const story = selectNextStory(prd);
    if (!story) {
      terminationReason = "all_passed";
      break;
    }

    console.error(
      `ralph: iteration ${iteration}/${config.maxIterations} - story ${story.id}: ${story.title}`,
    );

    const iterStartedAt = isoNow();

    // Read accumulated progress and truncate to last 5 entries for the prompt
    const rawProgress = await readProgressFile(ralphDir);
    const progress = truncateProgress(rawProgress, 5);

    const prompt = config.promptTemplate ?? buildPrompt(prd, story, progress, iteration, config);

    // Build sandbox env with ralph-specific vars
    const env: Record<string, string> = { ...(args.env ?? {}) };
    env["MACBOX_RALPH_ITERATION"] = String(iteration);
    env["MACBOX_RALPH_STORY_ID"] = story.id;
    env["MACBOX_RALPH_MAX_ITERATIONS"] = String(config.maxIterations);

    // Run agent inside sandbox
    const agentCmd = [...baseCommand, prompt];
    let agentResult: { code: number; stdout?: string; stderr?: string };
    try {
      agentResult = await executeSandboxRun({
        worktreePath,
        repoRoot,
        gitCommonDir,
        gitDir,
        agent,
        profiles: args.profiles,
        caps: args.caps,
        command: agentCmd,
        env,
        debug,
        capture: true,
        stream: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ralph: agent invocation failed: ${msg}`);
      agentResult = { code: 1, stdout: "", stderr: msg };
    }

    // Check for completion signal
    const completionSignal = detectCompletionSignal(agentResult.stdout ?? "");
    if (completionSignal) {
      const iterResult: IterationResult = {
        iteration,
        storyId: story.id,
        storyTitle: story.title,
        agentExitCode: agentResult.code,
        agentStdout: agentResult.stdout,
        gateResults: [],
        allGatesPassed: true,
        committed: false,
        completionSignal: true,
        startedAt: iterStartedAt,
        completedAt: isoNow(),
      };
      iterations.push(iterResult);
      await appendProgress(ralphDir, iteration, story, [], false);
      terminationReason = "completion_signal";
      break;
    }

    // Run quality gates outside sandbox
    const gateResults: GateResult[] = [];
    let allGatesPassed = agentResult.code === 0;
    if (!allGatesPassed) {
      console.error(`ralph: agent exited with code ${agentResult.code}`);
    } else {
      for (const gate of config.qualityGates) {
        const gResult = await exec(["bash", "-lc", gate.cmd], { cwd: worktreePath });
        const passed = gResult.code === 0;
        gateResults.push({
          name: gate.name,
          exitCode: gResult.code,
          stdout: gResult.stdout,
          stderr: gResult.stderr,
          passed,
        });
        if (!passed) {
          console.error(`ralph: gate '${gate.name}' failed (exit ${gResult.code})`);
          if (!gate.continueOnFail) {
            allGatesPassed = false;
            break;
          }
        }
      }
    }

    // Commit and mark story as passed if all gates passed
    let committed = false;
    if (allGatesPassed) {
      if (config.commitOnPass) {
        try {
          await exec(["git", "add", "-A"], { cwd: worktreePath });
          const commitMsg = `feat: ${story.id} - ${story.title}`;
          const commitResult = await exec(["git", "commit", "-m", commitMsg, "--allow-empty"], {
            cwd: worktreePath,
          });
          if (commitResult.code === 0) {
            committed = true;
            prd = await updatePrdFile(prdPath, story.id);
            // Commit the updated prd.json too
            await exec(["git", "add", prdPath], { cwd: worktreePath });
            await exec(["git", "commit", "-m", `chore: mark ${story.id} as passed`], {
              cwd: worktreePath,
            });
          } else {
            console.error(`ralph: git commit failed: ${commitResult.stderr}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`ralph: commit error: ${msg}`);
        }
      } else {
        try {
          prd = await updatePrdFile(prdPath, story.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`ralph: failed to update prd.json: ${msg}`);
        }
      }
    }

    const iterResult: IterationResult = {
      iteration,
      storyId: story.id,
      storyTitle: story.title,
      agentExitCode: agentResult.code,
      agentStdout: agentResult.stdout,
      gateResults,
      allGatesPassed,
      committed,
      completionSignal: false,
      startedAt: iterStartedAt,
      completedAt: isoNow(),
    };
    iterations.push(iterResult);

    await appendProgress(ralphDir, iteration, story, gateResults, committed);

    // Persist state after each iteration
    const intermediateState: RalphState = {
      schema: "macbox.ralph.state.v1",
      prd,
      config,
      iterations,
      startedAt,
      allStoriesPassed: allStoriesPassed(prd),
      terminationReason: "running",
    };
    await persistState(ralphDir, intermediateState);

    // Check if all stories now pass
    if (allStoriesPassed(prd)) {
      terminationReason = "all_passed";
      break;
    }

    // Delay before next iteration (skip after last)
    if (iteration < config.maxIterations && config.delayBetweenIterationsMs > 0) {
      await new Promise((r) => setTimeout(r, config.delayBetweenIterationsMs));
    }
  }

  if (terminationReason === "running") {
    terminationReason = "max_iterations";
  }

  const finalState: RalphState = {
    schema: "macbox.ralph.state.v1",
    prd,
    config,
    iterations,
    startedAt,
    completedAt: isoNow(),
    allStoriesPassed: allStoriesPassed(prd),
    terminationReason,
  };
  await persistState(ralphDir, finalState);

  // Print summary
  const passed = prd.userStories.filter((s) => s.passes).length;
  const total = prd.userStories.length;
  console.error(
    `ralph: done - ${terminationReason} (${iterations.length} iterations, ${passed}/${total} stories passed)`,
  );

  return finalState;
};
