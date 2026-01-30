import { assert } from "./testutil.ts";
import { determineNextStep } from "../ralph_reducer.ts";
import type { RalphIntent } from "../ralph_reducer.ts";
import {
  appendEvent,
  createThread,
  mkEvent,
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

const configWithGates: RalphConfig = {
  ...defaultRalphConfig,
  qualityGates: [
    { name: "typecheck", cmd: "tsc --noEmit" },
    { name: "test", cmd: "npm test" },
  ],
};

const stubPrompt = (_prd: Prd, _story: Story, _iter: number): string => "stub prompt";

// ---------------------------------------------------------------------------
// Fresh thread
// ---------------------------------------------------------------------------

Deno.test("fresh thread returns run_agent for first story", () => {
  const prd = mkPrd([mkStory("US-001", 1, false), mkStory("US-002", 2, false)]);
  const thread = createThread(prd, testConfig);
  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "run_agent", "expected run_agent");
  if (intent.kind === "run_agent") {
    assert(intent.story.id === "US-001", "expected first story");
    assert(intent.iteration === 1, "expected iteration 1");
  }
});

Deno.test("fresh thread with all stories passed returns complete", () => {
  const prd = mkPrd([mkStory("US-001", 1, true), mkStory("US-002", 2, true)]);
  const thread = createThread(prd, testConfig);
  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "complete", "expected complete");
  if (intent.kind === "complete") {
    assert(intent.reason === "all_passed", "expected all_passed reason");
  }
});

// ---------------------------------------------------------------------------
// After agent success with gates
// ---------------------------------------------------------------------------

Deno.test("after agent success with gates returns run_gate", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, configWithGates);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_dispatched", { storyId: "US-001", iteration: 1 }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0, stdout: "done", completionSignal: false }));

  const intent = determineNextStep(thread, configWithGates, stubPrompt);
  assert(intent.kind === "run_gate", "expected run_gate");
  if (intent.kind === "run_gate") {
    assert(intent.gate.name === "typecheck", "expected first gate");
    assert(intent.gateIndex === 0, "expected gate index 0");
  }
});

Deno.test("after first gate passes returns next gate", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, configWithGates);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0, completionSignal: false }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001",
    gateIndex: 0,
    result: { name: "typecheck", exitCode: 0, passed: true },
  }));

  const intent = determineNextStep(thread, configWithGates, stubPrompt);
  assert(intent.kind === "run_gate", "expected run_gate");
  if (intent.kind === "run_gate") {
    assert(intent.gate.name === "test", "expected second gate");
    assert(intent.gateIndex === 1, "expected gate index 1");
  }
});

// ---------------------------------------------------------------------------
// After all gates pass
// ---------------------------------------------------------------------------

Deno.test("all gates pass returns commit when commitOnPass", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, configWithGates);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0, completionSignal: false }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001", gateIndex: 0,
    result: { name: "typecheck", exitCode: 0, passed: true },
  }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001", gateIndex: 1,
    result: { name: "test", exitCode: 0, passed: true },
  }));

  const intent = determineNextStep(thread, configWithGates, stubPrompt);
  assert(intent.kind === "commit", "expected commit");
  if (intent.kind === "commit") {
    assert(intent.storyId === "US-001", "expected story id");
  }
});

Deno.test("all gates pass returns mark_passed when commitOnPass=false", () => {
  const noCommitConfig: RalphConfig = { ...configWithGates, commitOnPass: false };
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, noCommitConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0, completionSignal: false }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001", gateIndex: 0,
    result: { name: "typecheck", exitCode: 0, passed: true },
  }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001", gateIndex: 1,
    result: { name: "test", exitCode: 0, passed: true },
  }));

  const intent = determineNextStep(thread, noCommitConfig, stubPrompt);
  assert(intent.kind === "mark_passed", "expected mark_passed");
});

// ---------------------------------------------------------------------------
// Commit completed -> mark_passed
// ---------------------------------------------------------------------------

Deno.test("after commit_completed returns mark_passed", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("commit_completed", { storyId: "US-001", success: true }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "mark_passed", "expected mark_passed");
  if (intent.kind === "mark_passed") {
    assert(intent.storyId === "US-001", "expected story id");
  }
});

// ---------------------------------------------------------------------------
// All stories passed
// ---------------------------------------------------------------------------

Deno.test("iteration_completed with all stories passed returns complete", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("story_passed", { storyId: "US-001" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "complete", "expected complete");
  if (intent.kind === "complete") {
    assert(intent.reason === "all_passed", "expected all_passed");
  }
});

// ---------------------------------------------------------------------------
// Max iterations
// ---------------------------------------------------------------------------

Deno.test("max iterations reached returns complete", () => {
  const cfg: RalphConfig = { ...testConfig, maxIterations: 2 };
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, cfg);
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: false }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 2, storyId: "US-001", allGatesPassed: false }));

  const intent = determineNextStep(thread, cfg, stubPrompt);
  assert(intent.kind === "complete", "expected complete");
  if (intent.kind === "complete") {
    assert(intent.reason === "max_iterations", "expected max_iterations");
  }
});

// ---------------------------------------------------------------------------
// Completion signal
// ---------------------------------------------------------------------------

Deno.test("agent_completed with completion signal returns complete", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", {
    storyId: "US-001",
    exitCode: 0,
    stdout: "<promise>COMPLETE</promise>",
    completionSignal: true,
  }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "complete", "expected complete");
  if (intent.kind === "complete") {
    assert(intent.reason === "completion_signal", "expected completion_signal");
  }
});

// ---------------------------------------------------------------------------
// Agent failure
// ---------------------------------------------------------------------------

Deno.test("agent_completed with failure returns wait_delay (iteration loop continues)", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", {
    storyId: "US-001", exitCode: 1, stdout: "", completionSignal: false,
  }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "wait_delay", "expected wait_delay for failed agent");
});

// ---------------------------------------------------------------------------
// Consecutive failures -> human input
// ---------------------------------------------------------------------------

Deno.test("consecutive errors exceed threshold returns request_human_input", () => {
  const cfg: RalphConfig = { ...testConfig, maxConsecutiveFailures: 2 };
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, cfg);
  // Simulate 1 completed failed iteration
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: false }));
  // Now another agent failure in new iteration
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 2, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", {
    storyId: "US-001", exitCode: 1, stdout: "", completionSignal: false,
  }));

  const intent = determineNextStep(thread, cfg, stubPrompt);
  assert(intent.kind === "request_human_input", "expected request_human_input");
});

// ---------------------------------------------------------------------------
// Approval before commit
// ---------------------------------------------------------------------------

Deno.test("requireApprovalBeforeCommit returns request_human_input after gates pass", () => {
  const cfg: RalphConfig = { ...configWithGates, requireApprovalBeforeCommit: true };
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, cfg);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", { storyId: "US-001", exitCode: 0, completionSignal: false }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001", gateIndex: 0,
    result: { name: "typecheck", exitCode: 0, passed: true },
  }));
  thread = appendEvent(thread, mkEvent("gate_completed", {
    storyId: "US-001", gateIndex: 1,
    result: { name: "test", exitCode: 0, passed: true },
  }));

  const intent = determineNextStep(thread, cfg, stubPrompt);
  assert(intent.kind === "request_human_input", "expected request_human_input");
});

// ---------------------------------------------------------------------------
// Human input flow
// ---------------------------------------------------------------------------

Deno.test("human_input_requested returns complete with human_input reason", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("human_input_requested", { reason: "need help", context: "stuck" }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "complete", "expected complete");
  if (intent.kind === "complete") {
    assert(intent.reason === "human_input", "expected human_input reason");
  }
});

Deno.test("human_input_received returns run_agent to continue", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("human_input_requested", { reason: "need help" }));
  thread = appendEvent(thread, mkEvent("human_input_received", { response: "do X" }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "run_agent", "expected run_agent after human input");
});

// ---------------------------------------------------------------------------
// Thread already completed
// ---------------------------------------------------------------------------

Deno.test("thread_completed returns complete", () => {
  const prd = mkPrd([mkStory("US-001", 1, true)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("thread_completed", { reason: "all_passed" }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "complete", "expected complete");
});

// ---------------------------------------------------------------------------
// No gates: agent success goes straight to commit/mark
// ---------------------------------------------------------------------------

Deno.test("agent success with no gates returns commit", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", {
    storyId: "US-001", exitCode: 0, stdout: "ok", completionSignal: false,
  }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "commit", "expected commit with no gates");
});

Deno.test("agent success with no gates and commitOnPass=false returns mark_passed", () => {
  const noCommit: RalphConfig = { ...testConfig, commitOnPass: false };
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, noCommit);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", {
    storyId: "US-001", exitCode: 0, stdout: "ok", completionSignal: false,
  }));

  const intent = determineNextStep(thread, noCommit, stubPrompt);
  assert(intent.kind === "mark_passed", "expected mark_passed");
});

// ---------------------------------------------------------------------------
// Next iteration after pass
// ---------------------------------------------------------------------------

Deno.test("after iteration_completed with remaining stories returns run_agent for next", () => {
  const prd = mkPrd([mkStory("US-001", 1, false), mkStory("US-002", 2, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("story_passed", { storyId: "US-001" }));
  thread = appendEvent(thread, mkEvent("iteration_completed", { iteration: 1, storyId: "US-001", allGatesPassed: true }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "run_agent", "expected run_agent");
  if (intent.kind === "run_agent") {
    assert(intent.story.id === "US-002", "expected next story US-002");
    assert(intent.iteration === 2, "expected iteration 2");
  }
});

// ---------------------------------------------------------------------------
// Agent request-input tag
// ---------------------------------------------------------------------------

Deno.test("agent output with request-input tag returns request_human_input", () => {
  const prd = mkPrd([mkStory("US-001", 1, false)]);
  let thread = createThread(prd, testConfig);
  thread = appendEvent(thread, mkEvent("iteration_started", { iteration: 1, storyId: "US-001", storyTitle: "Story US-001" }));
  thread = appendEvent(thread, mkEvent("agent_completed", {
    storyId: "US-001",
    exitCode: 0,
    stdout: "I need clarification <request-input>What API version?</request-input>",
    completionSignal: false,
  }));

  const intent = determineNextStep(thread, testConfig, stubPrompt);
  assert(intent.kind === "request_human_input", "expected request_human_input");
  if (intent.kind === "request_human_input") {
    assert(intent.reason === "What API version?", "expected reason from tag");
  }
});
