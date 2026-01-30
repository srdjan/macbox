// Ralph reducer - pure function that determines the next orchestration action.
// Given a Thread (event log), returns a RalphIntent describing what to do next.

import type {
  MultiAgentPhase,
  AgentRole,
  QualityGate,
  RalphConfig,
  Story,
} from "./ralph_types.ts";
import { PHASE_ORDER, PHASE_TO_ROLE } from "./ralph_types.ts";
import type { AgentKind } from "./agent.ts";
import { selectNextStory } from "./ralph.ts";
import type { RalphThread } from "./ralph_thread.ts";
import {
  completedIterationCount,
  consecutiveFailures,
  currentIteration,
  currentIterationPhases,
  lastEvent,
  lastEventOfType,
  nextPhase,
  phaseCompletionCount,
  threadToConfig,
  threadToPrd,
} from "./ralph_thread.ts";
import type { Prd } from "./ralph_types.ts";

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

export type RalphIntent =
  | {
      readonly kind: "run_agent";
      readonly story: Story;
      readonly prompt: string;
      readonly iteration: number;
      readonly phase?: MultiAgentPhase;
      readonly role?: AgentRole;
      readonly agent?: AgentKind;
    }
  | { readonly kind: "run_gate"; readonly gate: QualityGate; readonly storyId: string; readonly gateIndex: number }
  | { readonly kind: "commit"; readonly storyId: string; readonly storyTitle: string }
  | { readonly kind: "mark_passed"; readonly storyId: string }
  | { readonly kind: "request_human_input"; readonly reason: string; readonly context: string }
  | { readonly kind: "complete"; readonly reason: "all_passed" | "max_iterations" | "completion_signal" | "human_input" | "paused" }
  | { readonly kind: "wait_delay" };

/**
 * Prompt builder for multi-agent phases. Receives the phase context and
 * prior phase outputs so it can frame the agent's role appropriately.
 */
export type PhasePromptFn = (
  prd: Prd,
  story: Story,
  iteration: number,
  phase: MultiAgentPhase,
  priorPhaseOutputs: ReadonlyArray<{ phase: MultiAgentPhase; output: string }>,
) => string;

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Multi-agent helpers (pure)
// ---------------------------------------------------------------------------

/** Collect stdout from all phase_completed events preceding the target phase in the current iteration. */
const collectPriorPhaseOutputs = (
  thread: RalphThread,
  upToPhase: MultiAgentPhase,
): ReadonlyArray<{ phase: MultiAgentPhase; output: string }> => {
  const phases = currentIterationPhases(thread);
  const targetIdx = PHASE_ORDER.indexOf(upToPhase);
  return phases
    .filter((e) => {
      const p = e.data.phase as MultiAgentPhase;
      return PHASE_ORDER.indexOf(p) < targetIdx;
    })
    .map((e) => ({
      phase: e.data.phase as MultiAgentPhase,
      output: (e.data.stdout as string) ?? "",
    }));
};

/** Resolve agent kind for a given role using multi-agent config. */
const agentForRole = (role: AgentRole, config: RalphConfig): AgentKind => {
  const mc = config.multiAgent!;
  return role === "agent_a" ? mc.agentA : mc.agentB;
};

/** Build a run_agent intent for a multi-agent phase. */
const phaseIntent = (
  story: Story,
  iteration: number,
  phase: MultiAgentPhase,
  config: RalphConfig,
  thread: RalphThread,
  buildPhasePromptFn: PhasePromptFn,
  prd: Prd,
): RalphIntent => {
  const role = PHASE_TO_ROLE[phase];
  const agent = agentForRole(role, config);
  const priorOutputs = collectPriorPhaseOutputs(thread, phase);
  const prompt = buildPhasePromptFn(prd, story, iteration, phase, priorOutputs);
  return { kind: "run_agent", story, prompt, iteration, phase, role, agent };
};

/** After all phases complete, determine the next step (gates, approval, commit, or mark passed). */
const postPhasesIntent = (storyId: string, config: RalphConfig, prd: Prd): RalphIntent => {
  if (config.qualityGates.length > 0) {
    return { kind: "run_gate", gate: config.qualityGates[0], storyId, gateIndex: 0 };
  }
  if (config.requireApprovalBeforeCommit) {
    return {
      kind: "request_human_input",
      reason: "Approval required before commit",
      context: `All phases and quality checks passed for story ${storyId}`,
    };
  }
  if (config.commitOnPass) {
    const story = prd.userStories.find((s) => s.id === storyId);
    return { kind: "commit", storyId, storyTitle: story?.title ?? storyId };
  }
  return { kind: "mark_passed", storyId };
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: given the full event log, determine what orchestration action to take next.
 *
 * The `buildPromptFn` parameter allows the caller to inject prompt construction,
 * keeping this module free of prompt-building dependencies.
 *
 * The optional `buildPhasePromptFn` is used when multi-agent mode is enabled,
 * to build phase-specific prompts with prior phase context.
 */
export const determineNextStep = (
  thread: RalphThread,
  config: RalphConfig,
  buildPromptFn: (prd: ReturnType<typeof threadToPrd>, story: Story, iteration: number) => string,
  buildPhasePromptFn?: PhasePromptFn,
): RalphIntent => {
  const last = lastEvent(thread);
  if (!last) {
    throw new Error("Thread has no events");
  }

  const prd = threadToPrd(thread);
  const iteration = currentIteration(thread);
  const isMultiAgent = config.multiAgent?.enabled === true && buildPhasePromptFn != null;

  switch (last.type) {
    // -----------------------------------------------------------------------
    // Thread just started: pick first story
    // -----------------------------------------------------------------------
    case "thread_started": {
      const story = selectNextStory(prd);
      if (!story) return { kind: "complete", reason: "all_passed" };
      if (isMultiAgent) {
        return phaseIntent(story, iteration, "brainstorm", config, thread, buildPhasePromptFn!, prd);
      }
      const prompt = buildPromptFn(prd, story, iteration);
      return { kind: "run_agent", story, prompt, iteration };
    }

    // -----------------------------------------------------------------------
    // Iteration started: dispatch agent
    // -----------------------------------------------------------------------
    case "iteration_started": {
      const storyId = last.data.storyId as string;
      const story = prd.userStories.find((s) => s.id === storyId);
      if (!story) return { kind: "complete", reason: "all_passed" };
      if (isMultiAgent) {
        return phaseIntent(story, iteration, "brainstorm", config, thread, buildPhasePromptFn!, prd);
      }
      const prompt = buildPromptFn(prd, story, iteration);
      return { kind: "run_agent", story, prompt, iteration };
    }

    // -----------------------------------------------------------------------
    // Agent dispatched: wait for completion (handled externally)
    // -----------------------------------------------------------------------
    case "agent_dispatched":
      return { kind: "wait_delay" };

    // -----------------------------------------------------------------------
    // Agent completed: check for completion signal, then gates
    // (Only reached in single-agent mode; multi-agent uses phase_completed)
    // -----------------------------------------------------------------------
    case "agent_completed": {
      // Completion signal takes priority
      if (last.data.completionSignal) {
        return { kind: "complete", reason: "completion_signal" };
      }

      // Check for human input request in agent output
      const agentOutput = (last.data.stdout as string) ?? "";
      const inputMatch = agentOutput.match(/<request-input>([\s\S]*?)<\/request-input>/);
      if (inputMatch) {
        return {
          kind: "request_human_input",
          reason: inputMatch[1].trim(),
          context: `Agent requested input during iteration ${iteration}`,
        };
      }

      const exitCode = last.data.exitCode as number;
      const storyId = last.data.storyId as string;

      // Agent failed: no gates to run
      if (exitCode !== 0) {
        const failures = consecutiveFailures(thread, storyId) + 1;
        if (config.maxConsecutiveFailures && failures >= config.maxConsecutiveFailures) {
          return {
            kind: "request_human_input",
            reason: `${failures} consecutive failures on story ${storyId}`,
            context: `Agent exited with code ${exitCode}`,
          };
        }
        return { kind: "wait_delay" };
      }

      // Agent succeeded: run gates if any
      if (config.qualityGates.length > 0) {
        return { kind: "run_gate", gate: config.qualityGates[0], storyId, gateIndex: 0 };
      }

      if (config.requireApprovalBeforeCommit) {
        return {
          kind: "request_human_input",
          reason: "Approval required before commit",
          context: `All quality checks passed for story ${storyId}`,
        };
      }

      if (config.commitOnPass) {
        const story = prd.userStories.find((s) => s.id === storyId);
        return { kind: "commit", storyId, storyTitle: story?.title ?? storyId };
      }
      return { kind: "mark_passed", storyId };
    }

    // -----------------------------------------------------------------------
    // Phase started: agent is executing, wait
    // -----------------------------------------------------------------------
    case "phase_started":
      return { kind: "wait_delay" };

    // -----------------------------------------------------------------------
    // Phase completed: advance to next phase or proceed to gates
    // -----------------------------------------------------------------------
    case "phase_completed": {
      const completedPhase = last.data.phase as MultiAgentPhase;
      const storyId = last.data.storyId as string;
      const exitCode = last.data.exitCode as number;
      const story = prd.userStories.find((s) => s.id === storyId);
      if (!story) return { kind: "complete", reason: "all_passed" };

      // Execution phases (execute, incorporate_aar): failure means iteration failed
      if (exitCode !== 0 && (completedPhase === "execute" || completedPhase === "incorporate_aar")) {
        return { kind: "wait_delay" }; // signals iteration failure
      }

      // Advisory phases (brainstorm, clarify, plan): failure retries once, then skips to execute
      if (exitCode !== 0) {
        const retries = phaseCompletionCount(thread, completedPhase);
        if (retries <= 1) {
          // Retry the same phase
          return phaseIntent(story, iteration, completedPhase, config, thread, buildPhasePromptFn!, prd);
        }
        // Skip to execute phase with whatever context exists
        return phaseIntent(story, iteration, "execute", config, thread, buildPhasePromptFn!, prd);
      }

      // AAR retry-then-pause logic:
      // After incorporate_aar completes successfully, check if this was a retry cycle.
      // If aar has run more than once (retry happened), pause for human input.
      if (completedPhase === "incorporate_aar") {
        const aarRuns = phaseCompletionCount(thread, "aar");
        if (aarRuns > 1) {
          return {
            kind: "request_human_input",
            reason: `AAR retry cycle completed for story ${storyId} - review recommended`,
            context: `AAR ran ${aarRuns} times. Human judgment requested.`,
          };
        }
      }

      // Phase succeeded: advance to next phase
      const next = nextPhase(completedPhase);
      if (next === null) {
        // All phases complete - proceed to gates/commit
        return postPhasesIntent(storyId, config, prd);
      }

      return phaseIntent(story, iteration, next, config, thread, buildPhasePromptFn!, prd);
    }

    // -----------------------------------------------------------------------
    // Gate completed: run next gate or proceed
    // -----------------------------------------------------------------------
    case "gate_completed": {
      const storyId = last.data.storyId as string;
      const gatePassed = (last.data.result as { passed: boolean })?.passed ?? false;
      const gateIndex = (last.data.gateIndex as number) ?? 0;
      const gateName = (last.data.result as { name: string })?.name ?? "";

      if (!gatePassed) {
        const gate = config.qualityGates.find((g) => g.name === gateName);
        if (!gate?.continueOnFail) {
          return { kind: "wait_delay" };
        }
      }

      const nextIdx = gateIndex + 1;
      if (nextIdx < config.qualityGates.length) {
        return { kind: "run_gate", gate: config.qualityGates[nextIdx], storyId, gateIndex: nextIdx };
      }

      const lastIterStart = lastEventOfType(thread, "iteration_started");
      const lastIterIdx = lastIterStart ? thread.events.indexOf(lastIterStart) : 0;
      const currentGateEvents = thread.events.slice(lastIterIdx).filter(
        (e) => e.type === "gate_completed"
      );
      const allPassed = currentGateEvents.every(
        (e) => (e.data.result as { passed: boolean })?.passed
      );

      if (!allPassed) {
        return { kind: "wait_delay" };
      }

      if (config.requireApprovalBeforeCommit) {
        return {
          kind: "request_human_input",
          reason: "Approval required before commit",
          context: `All quality gates passed for story ${storyId}`,
        };
      }

      if (config.commitOnPass) {
        const story = prd.userStories.find((s) => s.id === storyId);
        return { kind: "commit", storyId, storyTitle: story?.title ?? storyId };
      }
      return { kind: "mark_passed", storyId };
    }

    // -----------------------------------------------------------------------
    // Commit completed: mark story as passed
    // -----------------------------------------------------------------------
    case "commit_completed": {
      const storyId = last.data.storyId as string;
      return { kind: "mark_passed", storyId };
    }

    // -----------------------------------------------------------------------
    // Story passed
    // -----------------------------------------------------------------------
    case "story_passed": {
      return { kind: "wait_delay" };
    }

    // -----------------------------------------------------------------------
    // Iteration completed: start next iteration or finish
    // -----------------------------------------------------------------------
    case "iteration_completed": {
      const completedCount = completedIterationCount(thread);
      if (completedCount >= config.maxIterations) {
        return { kind: "complete", reason: "max_iterations" };
      }

      const updatedPrd = threadToPrd(thread);
      if (updatedPrd.userStories.every((s) => s.passes)) {
        return { kind: "complete", reason: "all_passed" };
      }

      const story = selectNextStory(updatedPrd);
      if (!story) return { kind: "complete", reason: "all_passed" };

      const nextIter = completedCount + 1;
      if (isMultiAgent) {
        return phaseIntent(story, nextIter, "brainstorm", config, thread, buildPhasePromptFn!, updatedPrd);
      }
      const prompt = buildPromptFn(updatedPrd, story, nextIter);
      return { kind: "run_agent", story, prompt, iteration: nextIter };
    }

    // -----------------------------------------------------------------------
    // Human input events
    // -----------------------------------------------------------------------
    case "human_input_requested":
      return { kind: "complete", reason: "human_input" };

    case "human_input_received": {
      const updatedPrd = threadToPrd(thread);
      const story = selectNextStory(updatedPrd);
      if (!story) return { kind: "complete", reason: "all_passed" };
      const nextIter = currentIteration(thread);
      if (isMultiAgent) {
        // Resume from last completed phase
        const lastPhase = last.data.resumeFromPhase as MultiAgentPhase | undefined;
        const resumePhase = lastPhase ? nextPhase(lastPhase) ?? "brainstorm" : "brainstorm";
        return phaseIntent(story, nextIter, resumePhase, config, thread, buildPhasePromptFn!, updatedPrd);
      }
      const prompt = buildPromptFn(updatedPrd, story, nextIter);
      return { kind: "run_agent", story, prompt, iteration: nextIter };
    }

    // -----------------------------------------------------------------------
    // Thread already completed
    // -----------------------------------------------------------------------
    case "thread_completed":
      return { kind: "complete", reason: (last.data.reason as RalphIntent["kind"] extends "complete" ? "all_passed" : "all_passed") ?? "all_passed" };

    // -----------------------------------------------------------------------
    // Error events
    // -----------------------------------------------------------------------
    case "error": {
      return { kind: "wait_delay" };
    }

    case "gate_started":
      return { kind: "wait_delay" };

    default:
      return { kind: "wait_delay" };
  }
};
