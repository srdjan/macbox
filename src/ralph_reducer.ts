// Ralph reducer - pure function that determines the next orchestration action.
// Given a Thread (event log), returns a RalphIntent describing what to do next.

import type { QualityGate, RalphConfig, Story } from "./ralph_types.ts";
import { selectNextStory } from "./ralph.ts";
import type { RalphThread } from "./ralph_thread.ts";
import {
  completedIterationCount,
  consecutiveFailures,
  currentIteration,
  lastEvent,
  lastEventOfType,
  threadToConfig,
  threadToPrd,
} from "./ralph_thread.ts";

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

export type RalphIntent =
  | { readonly kind: "run_agent"; readonly story: Story; readonly prompt: string; readonly iteration: number }
  | { readonly kind: "run_gate"; readonly gate: QualityGate; readonly storyId: string; readonly gateIndex: number }
  | { readonly kind: "commit"; readonly storyId: string; readonly storyTitle: string }
  | { readonly kind: "mark_passed"; readonly storyId: string }
  | { readonly kind: "request_human_input"; readonly reason: string; readonly context: string }
  | { readonly kind: "complete"; readonly reason: "all_passed" | "max_iterations" | "completion_signal" | "human_input" | "paused" }
  | { readonly kind: "wait_delay" };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: given the full event log, determine what orchestration action to take next.
 *
 * The `buildPromptFn` parameter allows the caller to inject prompt construction,
 * keeping this module free of prompt-building dependencies.
 */
export const determineNextStep = (
  thread: RalphThread,
  config: RalphConfig,
  buildPromptFn: (prd: ReturnType<typeof threadToPrd>, story: Story, iteration: number) => string,
): RalphIntent => {
  const last = lastEvent(thread);
  if (!last) {
    throw new Error("Thread has no events");
  }

  const prd = threadToPrd(thread);
  const iteration = currentIteration(thread);

  switch (last.type) {
    // -----------------------------------------------------------------------
    // Thread just started: pick first story
    // -----------------------------------------------------------------------
    case "thread_started": {
      const story = selectNextStory(prd);
      if (!story) return { kind: "complete", reason: "all_passed" };
      const prompt = buildPromptFn(prd, story, iteration);
      return { kind: "run_agent", story, prompt, iteration };
    }

    // -----------------------------------------------------------------------
    // Iteration started: dispatch agent
    // (iteration_started already logged - agent should be dispatched by caller)
    // -----------------------------------------------------------------------
    case "iteration_started": {
      const storyId = last.data.storyId as string;
      const story = prd.userStories.find((s) => s.id === storyId);
      if (!story) return { kind: "complete", reason: "all_passed" };
      const prompt = buildPromptFn(prd, story, iteration);
      return { kind: "run_agent", story, prompt, iteration };
    }

    // -----------------------------------------------------------------------
    // Agent dispatched: wait for completion (handled externally)
    // -----------------------------------------------------------------------
    case "agent_dispatched":
      // The caller is responsible for running the agent and appending agent_completed.
      // If we get here, the agent hasn't finished yet - should not happen in sync loop.
      return { kind: "wait_delay" };

    // -----------------------------------------------------------------------
    // Agent completed: check for completion signal, then gates
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
        // Check consecutive failures for human escalation
        const failures = consecutiveFailures(thread, storyId) + 1; // +1 for this one
        if (config.maxConsecutiveFailures && failures >= config.maxConsecutiveFailures) {
          return {
            kind: "request_human_input",
            reason: `${failures} consecutive failures on story ${storyId}`,
            context: `Agent exited with code ${exitCode}`,
          };
        }
        // No gates to run when agent fails - complete iteration
        return { kind: "wait_delay" }; // signals: append iteration_completed, then continue
      }

      // Agent succeeded: run gates if any
      if (config.qualityGates.length > 0) {
        return { kind: "run_gate", gate: config.qualityGates[0], storyId, gateIndex: 0 };
      }

      // No gates: check approval requirement
      if (config.requireApprovalBeforeCommit) {
        return {
          kind: "request_human_input",
          reason: "Approval required before commit",
          context: `All quality checks passed for story ${storyId}`,
        };
      }

      // No gates, no approval needed: commit or mark passed
      if (config.commitOnPass) {
        const story = prd.userStories.find((s) => s.id === storyId);
        return { kind: "commit", storyId, storyTitle: story?.title ?? storyId };
      }
      return { kind: "mark_passed", storyId };
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
          // Gate failed, not continuable: iteration failed
          return { kind: "wait_delay" }; // signals: iteration_completed with failure
        }
      }

      // More gates to run?
      const nextIdx = gateIndex + 1;
      if (nextIdx < config.qualityGates.length) {
        return { kind: "run_gate", gate: config.qualityGates[nextIdx], storyId, gateIndex: nextIdx };
      }

      // All gates run. Check if all passed.
      const iterGateEvents = thread.events.filter(
        (e) => e.type === "gate_completed" && e.data.storyId === storyId
      );
      // Find gate events from the current iteration
      const lastIterStart = lastEventOfType(thread, "iteration_started");
      const lastIterIdx = lastIterStart ? thread.events.indexOf(lastIterStart) : 0;
      const currentGateEvents = thread.events.slice(lastIterIdx).filter(
        (e) => e.type === "gate_completed"
      );
      const allPassed = currentGateEvents.every(
        (e) => (e.data.result as { passed: boolean })?.passed
      );

      if (!allPassed) {
        return { kind: "wait_delay" }; // iteration failed
      }

      // All gates passed: check approval requirement
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
    // Story passed: check if more stories remain, or complete
    // -----------------------------------------------------------------------
    case "story_passed": {
      return { kind: "wait_delay" }; // signals: append iteration_completed, loop continues
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
      const prompt = buildPromptFn(updatedPrd, story, nextIter);
      return { kind: "run_agent", story, prompt, iteration: nextIter };
    }

    // -----------------------------------------------------------------------
    // Human input events
    // -----------------------------------------------------------------------
    case "human_input_requested":
      return { kind: "complete", reason: "human_input" };

    case "human_input_received": {
      // Resume from where we left off. Find what was happening before the request.
      // The thread should continue with the next logical step.
      const updatedPrd = threadToPrd(thread);
      const story = selectNextStory(updatedPrd);
      if (!story) return { kind: "complete", reason: "all_passed" };
      const nextIter = currentIteration(thread);
      const prompt = buildPromptFn(updatedPrd, story, nextIter);
      return { kind: "run_agent", story, prompt, iteration: nextIter };
    }

    // -----------------------------------------------------------------------
    // Thread already completed
    // -----------------------------------------------------------------------
    case "thread_completed":
      return { kind: "complete", reason: (last.data.reason as RalphIntent["kind"] extends "complete" ? "all_passed" : "all_passed") ?? "all_passed" };

    // -----------------------------------------------------------------------
    // Error events: continue - the loop should decide what to do
    // -----------------------------------------------------------------------
    case "error": {
      // After an error, the loop should have appended further events.
      // If error is the last event, treat as needing to continue the current iteration.
      return { kind: "wait_delay" };
    }

    case "gate_started":
      return { kind: "wait_delay" };

    default:
      return { kind: "wait_delay" };
  }
};
