import { assert } from "./testutil.ts";
import {
  appendEvent,
  createThread,
  mkEvent,
  serializeForPrompt,
  threadToConfig,
  threadToPrd,
  threadToProgress,
  threadToState,
  completedIterationCount,
  currentIteration,
  consecutiveFailures,
  detectHumanInputRequest,
  lastEvent,
  lastEventOfType,
  currentIterationPhases,
  lastCompletedPhase,
  nextPhase,
  phaseCompletionCount,
} from "../ralph_thread.ts";
import type { RalphThread } from "../ralph_thread.ts";
import type { Prd, RalphConfig, Story } from "../ralph_types.ts";
import { defaultRalphConfig } from "../ralph_types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkStory = (id: string, priority: number, passes: boolean): Story => ({
  id,
  title: `Story ${id}`,
  description: `Description for ${id}`,
  acceptanceCriteria: ["Criterion 1"],
  priority,
  passes,
});

const mkPrd = (stories: ReadonlyArray<Story>): Prd => ({
  project: "test",
  description: "test project",
  userStories: stories,
});

const testConfig: RalphConfig = { ...defaultRalphConfig };

// ---------------------------------------------------------------------------
// createThread
// ---------------------------------------------------------------------------

Deno.test("createThread produces correct initial event", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig);
  assert(thread.schema === "macbox.ralph.thread.v1", "expected thread schema");
  assert(thread.events.length === 1, "expected 1 event");
  assert(thread.events[0].type === "thread_started", "expected thread_started");
  assert((thread.events[0].data.prd as Prd).project === "test", "expected prd in data");
  assert((thread.events[0].data.config as RalphConfig).maxIterations === 10, "expected config");
});

Deno.test("createThread includes runArgs in data", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig, { worktreePath: "/tmp/wt" });
  assert(thread.events[0].data.worktreePath === "/tmp/wt", "expected runArgs");
});

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

Deno.test("appendEvent is immutable", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig);
  const newEvent = mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" });
  const updated = appendEvent(thread, newEvent);

  assert(thread.events.length === 1, "original unchanged");
  assert(updated.events.length === 2, "new thread has 2 events");
  assert(updated !== thread, "different reference");
  assert(updated.events !== thread.events, "different events array");
});

Deno.test("appendEvent preserves schema", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig);
  const updated = appendEvent(thread, mkEvent("error", { source: "test", message: "fail" }));
  assert(updated.schema === "macbox.ralph.thread.v1", "schema preserved");
});

// ---------------------------------------------------------------------------
// threadToPrd
// ---------------------------------------------------------------------------

Deno.test("threadToPrd returns base prd when no story_passed events", () => {
  const prd = mkPrd([mkStory("US-001", 1, false), mkStory("US-002", 2, false)]);
  const thread = createThread(prd, testConfig);
  const derived = threadToPrd(thread);
  assert(derived.userStories.length === 2, "expected 2 stories");
  assert(!derived.userStories[0].passes, "US-001 not passed");
  assert(!derived.userStories[1].passes, "US-002 not passed");
});

Deno.test("threadToPrd reflects story_passed events", () => {
  const prd = mkPrd([mkStory("US-001", 1, false), mkStory("US-002", 2, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("story_passed", { storyId: "US-001" }));
  const derived = threadToPrd(thread);
  assert(derived.userStories[0].passes === true, "US-001 should be passed");
  assert(derived.userStories[1].passes === false, "US-002 should not be passed");
});

Deno.test("threadToPrd handles multiple story_passed events", () => {
  const prd = mkPrd([mkStory("US-001", 1, false), mkStory("US-002", 2, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("story_passed", { storyId: "US-001" }));
  thread = appendEvent(thread, mkEvent("story_passed", { storyId: "US-002" }));
  const derived = threadToPrd(thread);
  assert(derived.userStories.every((s) => s.passes), "all stories passed");
});

// ---------------------------------------------------------------------------
// threadToState
// ---------------------------------------------------------------------------

Deno.test("threadToState derives correct RalphState from minimal thread", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig);
  const state = threadToState(thread);
  assert(state.schema === "macbox.ralph.state.v1", "expected state schema");
  assert(state.prd.project === "test", "expected prd");
  assert(state.iterations.length === 0, "no iterations yet");
  assert(state.terminationReason === "running", "expected running");
  assert(!state.allStoriesPassed, "not all passed");
});

Deno.test("threadToState derives iterations from event sequence", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0, stdout: "done" }));
  thread = appendEvent(thread, mkEvent("story_passed", { storyId: "US-001" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));
  thread = appendEvent(thread, mkEvent("thread_completed", { reason: "all_passed" }));

  const state = threadToState(thread);
  assert(state.iterations.length === 1, "expected 1 iteration");
  assert(state.iterations[0].storyId === "US-001", "expected US-001");
  assert(state.iterations[0].allGatesPassed === true, "expected gates passed");
  assert(state.terminationReason === "all_passed", "expected all_passed");
  assert(state.allStoriesPassed, "all stories passed");
});

Deno.test("threadToState includes completedAt when thread is completed", () => {
  const prd = mkPrd([mkStory("US-001", 1, true)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("thread_completed", { reason: "all_passed" }));
  const state = threadToState(thread);
  assert(state.completedAt !== undefined, "expected completedAt");
});

// ---------------------------------------------------------------------------
// threadToProgress
// ---------------------------------------------------------------------------

Deno.test("threadToProgress returns empty string for no iterations", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig);
  assert(threadToProgress(thread) === "", "expected empty progress");
});

Deno.test("threadToProgress includes iteration summaries", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0 }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));
  const progress = threadToProgress(thread);
  assert(progress.includes("Iteration 1"), "expected iteration number");
  assert(progress.includes("US-001"), "expected story id");
});

// ---------------------------------------------------------------------------
// serializeForPrompt
// ---------------------------------------------------------------------------

Deno.test("serializeForPrompt produces XML for empty thread", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  const thread = createThread(prd, testConfig);
  const xml = serializeForPrompt(thread);
  assert(xml.includes("execution-history"), "expected execution-history tag");
  assert(xml.includes('count="0"'), "expected count 0");
});

Deno.test("serializeForPrompt includes iteration data", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0 }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));
  const xml = serializeForPrompt(thread);
  assert(xml.includes('n="1"'), "expected iteration number");
  assert(xml.includes('story="US-001"'), "expected story id");
});

Deno.test("serializeForPrompt truncates old iterations", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  for (let i = 1; i <= 8; i++) {
    thread = appendEvent(thread, mkEvent("iteration_started", { iteration: i, storyId: "US-001", storyTitle: "Story US-001" }));
    thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 1 }));
    thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: i, storyId: "US-001", allGatesPassed: false }));
  }
  const xml = serializeForPrompt(thread, { maxIterationHistory: 3 });
  assert(xml.includes('count="8"'), "expected total count");
  assert(xml.includes("omitted"), "expected omitted note");
});

Deno.test("serializeForPrompt includes errors", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("error", { source: "agent_invocation", message: "boom" }));
  const xml = serializeForPrompt(thread);
  assert(xml.includes("<errors"), "expected errors tag");
  assert(xml.includes("agent_invocation"), "expected error source");
  assert(xml.includes("boom"), "expected error message");
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

Deno.test("completedIterationCount returns 0 for fresh thread", () => {
  const thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  assert(completedIterationCount(thread) === 0, "expected 0");
});

Deno.test("completedIterationCount counts iteration_completed events", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 2, storyId: "US-001", storyTitle: "" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 2, storyId: "US-001", allGatesPassed: false }));
  assert(completedIterationCount(thread) === 2, "expected 2");
});

Deno.test("currentIteration returns 1 for fresh thread", () => {
  const thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  assert(currentIteration(thread) === 1, "expected 1");
});

Deno.test("consecutiveFailures counts streak on same story", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: false }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 2, storyId: "US-001", allGatesPassed: false }));
  assert(consecutiveFailures(thread, "US-001") === 2, "expected 2 failures");
});

Deno.test("consecutiveFailures resets on success", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: false }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 2, storyId: "US-001", allGatesPassed: true }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 3, storyId: "US-001", allGatesPassed: false }));
  assert(consecutiveFailures(thread, "US-001") === 1, "expected 1 failure after reset");
});

Deno.test("detectHumanInputRequest extracts reason", () => {
  const result = detectHumanInputRequest("some output <request-input>need help</request-input> more");
  assert(result === "need help", "expected reason");
});

Deno.test("detectHumanInputRequest returns null when absent", () => {
  assert(detectHumanInputRequest("normal output") === null, "expected null");
});

Deno.test("lastEvent returns the last event", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("error", { source: "test", message: "fail" }));
  const last = lastEvent(thread);
  assert(last?.type === "error", "expected error event");
});

Deno.test("lastEventOfType finds correct event", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1 }));
  thread = appendEvent(thread, mkEvent("error", { source: "test" }));
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 2 }));
  const found = lastEventOfType(thread, "iteration_started");
  assert(found?.data.iteration === 2, "expected iteration 2");
});

// ---------------------------------------------------------------------------
// Multi-agent query helpers
// ---------------------------------------------------------------------------

Deno.test("currentIterationPhases returns empty for fresh thread", () => {
  const thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  assert(currentIterationPhases(thread).length === 0, "expected empty");
});

Deno.test("currentIterationPhases returns phase_completed events from current iteration", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("phase_started", { phase: "brainstorm", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 1 }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "brainstorm", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 1, exitCode: 0, stdout: "ideas" }));
  thread = appendEvent(thread, mkEvent("phase_started", { phase: "clarify", role: "agent_b", agent: "codex", storyId: "US-001", iteration: 1 }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "clarify", role: "agent_b", agent: "codex", storyId: "US-001", iteration: 1, exitCode: 0, stdout: "questions" }));
  const phases = currentIterationPhases(thread);
  assert(phases.length === 2, `expected 2 phase_completed events, got ${phases.length}`);
  assert(phases[0].data.phase === "brainstorm", "first phase should be brainstorm");
  assert(phases[1].data.phase === "clarify", "second phase should be clarify");
});

Deno.test("currentIterationPhases ignores phases from previous iterations", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  // Iteration 1
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "brainstorm", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 1, exitCode: 0, stdout: "old" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: false }));
  // Iteration 2
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 2, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "brainstorm", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 2, exitCode: 0, stdout: "new" }));
  const phases = currentIterationPhases(thread);
  assert(phases.length === 1, `expected 1 phase from current iteration, got ${phases.length}`);
  assert(phases[0].data.stdout === "new", "should be from iteration 2");
});

Deno.test("lastCompletedPhase returns null when no phases", () => {
  const thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  assert(lastCompletedPhase(thread) === null, "expected null");
});

Deno.test("lastCompletedPhase returns correct phase", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "brainstorm", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 1, exitCode: 0 }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "clarify", role: "agent_b", agent: "codex", storyId: "US-001", iteration: 1, exitCode: 0 }));
  assert(lastCompletedPhase(thread) === "clarify", "expected clarify");
});

Deno.test("nextPhase returns brainstorm for null input", () => {
  assert(nextPhase(null) === "brainstorm", "expected brainstorm");
});

Deno.test("nextPhase returns clarify after brainstorm", () => {
  assert(nextPhase("brainstorm") === "clarify", "expected clarify");
});

Deno.test("nextPhase returns plan after clarify", () => {
  assert(nextPhase("clarify") === "plan", "expected plan");
});

Deno.test("nextPhase returns execute after plan", () => {
  assert(nextPhase("plan") === "execute", "expected execute");
});

Deno.test("nextPhase returns aar after execute", () => {
  assert(nextPhase("execute") === "aar", "expected aar");
});

Deno.test("nextPhase returns incorporate_aar after aar", () => {
  assert(nextPhase("aar") === "incorporate_aar", "expected incorporate_aar");
});

Deno.test("nextPhase returns null after incorporate_aar", () => {
  assert(nextPhase("incorporate_aar") === null, "expected null");
});

Deno.test("phaseCompletionCount returns 0 when no phases", () => {
  const thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  assert(phaseCompletionCount(thread, "brainstorm") === 0, "expected 0");
});

Deno.test("phaseCompletionCount counts specific phase completions", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "aar", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 1, exitCode: 0 }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "incorporate_aar", role: "agent_b", agent: "codex", storyId: "US-001", iteration: 1, exitCode: 0 }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "aar", role: "agent_a", agent: "claude", storyId: "US-001", iteration: 1, exitCode: 0 }));
  assert(phaseCompletionCount(thread, "aar") === 2, "expected 2 aar completions");
  assert(phaseCompletionCount(thread, "incorporate_aar") === 1, "expected 1 incorporate_aar completion");
});

Deno.test("deriveIterations captures phase_completed exit codes", () => {
  let thread = createThread(mkPrd([mkStory("US-001", 1, false)]), testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "brainstorm", exitCode: 0, stdout: "ideas" }));
  thread = appendEvent(thread, mkEvent("phase_completed", { phase: "incorporate_aar", exitCode: 0, stdout: "final" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));
  const state = threadToState(thread);
  assert(state.iterations.length === 1, "expected 1 iteration");
  assert(state.iterations[0].agentExitCode === 0, "expected exit code 0 from last phase");
  assert(state.iterations[0].agentStdout === "final", "expected stdout from last phase");
});
