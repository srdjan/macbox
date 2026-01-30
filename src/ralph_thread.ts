// Ralph Thread model - event-sourced state for the autonomous loop.
// All Ralph state derives from the Thread's event sequence.

import type {
  GateResult,
  IterationResult,
  Prd,
  RalphConfig,
  RalphState,
  Story,
  TerminationReason,
} from "./ralph_types.ts";
import { ensureDir } from "./fs.ts";
import { pathJoin } from "./os.ts";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type RalphEventType =
  | "thread_started"
  | "iteration_started"
  | "agent_dispatched"
  | "agent_completed"
  | "gate_started"
  | "gate_completed"
  | "story_passed"
  | "commit_completed"
  | "iteration_completed"
  | "error"
  | "human_input_requested"
  | "human_input_received"
  | "thread_completed";

export type RalphEvent = {
  readonly type: RalphEventType;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
};

export type RalphThread = {
  readonly schema: "macbox.ralph.thread.v1";
  readonly events: ReadonlyArray<RalphEvent>;
};

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

const isoNow = () => new Date().toISOString();

export const createThread = (
  prd: Prd,
  config: RalphConfig,
  runArgs?: Record<string, unknown>,
): RalphThread => ({
  schema: "macbox.ralph.thread.v1",
  events: [{
    type: "thread_started",
    timestamp: isoNow(),
    data: {
      prd,
      config,
      ...(runArgs ?? {}),
    },
  }],
});

export const appendEvent = (
  thread: RalphThread,
  event: RalphEvent,
): RalphThread => ({
  schema: thread.schema,
  events: [...thread.events, event],
});

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

export const mkEvent = (type: RalphEventType, data: Record<string, unknown>): RalphEvent => ({
  type,
  timestamp: isoNow(),
  data,
});

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

/** Extract the Prd from the thread_started event. */
const basePrd = (thread: RalphThread): Prd => {
  const started = thread.events.find((e) => e.type === "thread_started");
  if (!started) throw new Error("Thread missing thread_started event");
  return started.data.prd as Prd;
};

/** Extract the config from the thread_started event. */
export const threadToConfig = (thread: RalphThread): RalphConfig => {
  const started = thread.events.find((e) => e.type === "thread_started");
  if (!started) throw new Error("Thread missing thread_started event");
  return started.data.config as RalphConfig;
};

/** Derive current PRD with updated `passes` flags from story_passed events. */
export const threadToPrd = (thread: RalphThread): Prd => {
  const prd = basePrd(thread);
  const passedIds = new Set(
    thread.events
      .filter((e) => e.type === "story_passed")
      .map((e) => e.data.storyId as string),
  );
  if (passedIds.size === 0) return prd;
  return {
    ...prd,
    userStories: prd.userStories.map((s) =>
      passedIds.has(s.id) ? { ...s, passes: true } : s
    ),
  };
};

/** Mutable working type for building iteration results from events. */
type IterationBuilder = {
  iteration: number;
  storyId: string;
  storyTitle: string;
  agentExitCode: number;
  agentStdout?: string;
  gateResults: GateResult[];
  committed: boolean;
  completionSignal: boolean;
  startedAt: string;
};

/** Derive iteration results from events. */
const deriveIterations = (thread: RalphThread): IterationResult[] => {
  const results: IterationResult[] = [];
  let current: IterationBuilder | null = null;

  for (const event of thread.events) {
    switch (event.type) {
      case "iteration_started":
        current = {
          iteration: event.data.iteration as number,
          storyId: event.data.storyId as string,
          storyTitle: event.data.storyTitle as string,
          agentExitCode: 1,
          gateResults: [],
          committed: false,
          completionSignal: false,
          startedAt: event.timestamp,
        };
        break;

      case "agent_completed":
        if (current) {
          current.agentExitCode = event.data.exitCode as number;
          current.agentStdout = event.data.stdout as string | undefined;
          current.completionSignal = event.data.completionSignal as boolean | undefined ?? false;
        }
        break;

      case "gate_completed":
        if (current) {
          current.gateResults.push(event.data.result as GateResult);
        }
        break;

      case "commit_completed":
        if (current) {
          current.committed = (event.data.success as boolean) ?? false;
        }
        break;

      case "iteration_completed": {
        if (current) {
          const allGatesPassed = (event.data.allGatesPassed as boolean) ?? false;
          results.push({
            iteration: current.iteration,
            storyId: current.storyId,
            storyTitle: current.storyTitle,
            agentExitCode: current.agentExitCode,
            agentStdout: current.agentStdout,
            gateResults: current.gateResults,
            allGatesPassed,
            committed: current.committed,
            completionSignal: current.completionSignal,
            startedAt: current.startedAt,
            completedAt: event.timestamp,
          });
          current = null;
        }
        break;
      }
    }
  }
  return results;
};

/** Derive the termination reason from events. */
const deriveTerminationReason = (thread: RalphThread): TerminationReason => {
  const completed = thread.events.findLast((e) => e.type === "thread_completed");
  if (completed) return (completed.data.reason as TerminationReason) ?? "running";
  return "running";
};

/** Derive a RalphState from the event sequence for backward compat. */
export const threadToState = (thread: RalphThread): RalphState => {
  const prd = threadToPrd(thread);
  const config = threadToConfig(thread);
  const iterations = deriveIterations(thread);
  const terminationReason = deriveTerminationReason(thread);

  const started = thread.events.find((e) => e.type === "thread_started");
  const completed = thread.events.findLast((e) => e.type === "thread_completed");

  return {
    schema: "macbox.ralph.state.v1",
    prd,
    config,
    iterations,
    startedAt: started?.timestamp ?? "",
    completedAt: completed?.timestamp,
    allStoriesPassed: prd.userStories.every((s) => s.passes),
    terminationReason,
  };
};

/** Derive a human-readable progress string from events. */
export const threadToProgress = (thread: RalphThread): string => {
  const iterations = deriveIterations(thread);
  if (iterations.length === 0) return "";
  return iterations.map((iter) => {
    const gateSummary = iter.gateResults.length > 0
      ? iter.gateResults.map((g) => `${g.name}: ${g.passed ? "PASS" : "FAIL"}`).join(", ")
      : "no gates";
    return `## Iteration ${iter.iteration} - ${iter.completedAt}
Story: ${iter.storyId} - ${iter.storyTitle}
Gates: ${gateSummary}
Committed: ${iter.committed ? "yes" : "no"}
---
`;
  }).join("");
};

// ---------------------------------------------------------------------------
// Prompt serialization
// ---------------------------------------------------------------------------

type SerializeOpts = {
  readonly maxErrorIterations?: number;
  readonly maxIterationHistory?: number;
};

/** Serialize thread into XML-style sections for the agent prompt. */
export const serializeForPrompt = (
  thread: RalphThread,
  opts?: SerializeOpts,
): string => {
  const maxErrors = opts?.maxErrorIterations ?? 3;
  const maxHistory = opts?.maxIterationHistory ?? 5;

  // Execution history from iteration events
  const iterations = deriveIterations(thread);
  const recentIterations = iterations.length > maxHistory
    ? iterations.slice(-maxHistory)
    : iterations;

  const historyEntries = recentIterations.map((iter) => {
    const gateSummary = iter.gateResults.length > 0
      ? iter.gateResults.map((g) => `  <gate name="${g.name}" passed="${g.passed}">${g.passed ? "" : (g.stderr ?? "").slice(0, 500)}</gate>`).join("\n")
      : "";
    return `  <iteration n="${iter.iteration}" story="${iter.storyId}" agent-exit="${iter.agentExitCode}" gates-passed="${iter.allGatesPassed}" committed="${iter.committed}">
${gateSummary}
  </iteration>`;
  });

  const omitted = iterations.length - recentIterations.length;
  const omittedNote = omitted > 0 ? `  <!-- ${omitted} earlier iteration(s) omitted -->\n` : "";

  const historyXml = historyEntries.length > 0
    ? `<execution-history count="${iterations.length}">\n${omittedNote}${historyEntries.join("\n")}\n</execution-history>`
    : `<execution-history count="0" />`;

  // Error compaction: recent errors only
  const errorEvents = thread.events.filter((e) => e.type === "error");
  // Group errors by looking at which iteration they're near
  const recentErrors = errorEvents.slice(-maxErrors * 2); // rough limit

  const errorsXml = recentErrors.length > 0
    ? `<errors count="${recentErrors.length}">\n${
      recentErrors.map((e) =>
        `  <error source="${e.data.source ?? "unknown"}">${String(e.data.message ?? "").slice(0, 500)}</error>`
      ).join("\n")
    }\n</errors>`
    : "";

  return [historyXml, errorsXml].filter(Boolean).join("\n\n");
};

// ---------------------------------------------------------------------------
// Thread query helpers (used by reducer)
// ---------------------------------------------------------------------------

/** Get the last event of a given type. */
export const lastEventOfType = (thread: RalphThread, type: RalphEventType): RalphEvent | undefined =>
  thread.events.findLast((e) => e.type === type);

/** Get the last event overall. */
export const lastEvent = (thread: RalphThread): RalphEvent | undefined =>
  thread.events.at(-1);

/** Count completed iterations. */
export const completedIterationCount = (thread: RalphThread): number =>
  thread.events.filter((e) => e.type === "iteration_completed").length;

/** Get the current iteration number (in-progress or next). */
export const currentIteration = (thread: RalphThread): number => {
  const last = lastEventOfType(thread, "iteration_started");
  if (!last) return 1;
  const n = last.data.iteration as number;
  // If iteration completed, next is n+1; otherwise current is n
  const completed = thread.events.findLast(
    (e) => e.type === "iteration_completed" && e.data.iteration === n
  );
  return completed ? n + 1 : n;
};

/** Count consecutive agent failures on the same story. */
export const consecutiveFailures = (thread: RalphThread, storyId: string): number => {
  let count = 0;
  // Walk events backward looking for iteration_completed for this story
  for (let i = thread.events.length - 1; i >= 0; i--) {
    const e = thread.events[i];
    if (e.type === "iteration_completed") {
      if (e.data.storyId === storyId && !(e.data.allGatesPassed as boolean)) {
        count++;
      } else {
        break; // different story or success breaks the streak
      }
    }
  }
  return count;
};

/** Check if agent output contains the human input request tag. */
export const detectHumanInputRequest = (output: string): string | null => {
  const match = output.match(/<request-input>([\s\S]*?)<\/request-input>/);
  return match ? match[1].trim() : null;
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const persistThread = async (ralphDir: string, thread: RalphThread): Promise<void> => {
  await ensureDir(ralphDir);
  const file = pathJoin(ralphDir, "thread.json");
  await Deno.writeTextFile(file, JSON.stringify(thread, null, 2) + "\n", { create: true });
};

export const loadThread = async (ralphDir: string): Promise<RalphThread | null> => {
  try {
    const file = pathJoin(ralphDir, "thread.json");
    const text = await Deno.readTextFile(file);
    const raw = JSON.parse(text);
    if (raw && typeof raw === "object" && raw.schema === "macbox.ralph.thread.v1" && Array.isArray(raw.events)) {
      return raw as RalphThread;
    }
    return null;
  } catch {
    return null;
  }
};
