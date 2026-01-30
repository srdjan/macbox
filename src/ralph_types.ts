// Ralph autonomous loop types.
// No runtime logic - only type exports and defaults.

import type { AgentKind } from "./agent.ts";

// ---------------------------------------------------------------------------
// Multi-agent orchestration types
// ---------------------------------------------------------------------------

export type MultiAgentPhase =
  | "brainstorm"
  | "clarify"
  | "plan"
  | "execute"
  | "aar"
  | "incorporate_aar";

export type AgentRole = "agent_a" | "agent_b";

export const PHASE_ORDER: ReadonlyArray<MultiAgentPhase> = [
  "brainstorm",
  "clarify",
  "plan",
  "execute",
  "aar",
  "incorporate_aar",
];

export const PHASE_TO_ROLE: Record<MultiAgentPhase, AgentRole> = {
  brainstorm: "agent_a",
  clarify: "agent_b",
  plan: "agent_a",
  execute: "agent_b",
  aar: "agent_a",
  incorporate_aar: "agent_b",
};

export type MultiAgentConfig = {
  readonly enabled: true;
  readonly agentA: AgentKind;
  readonly agentB: AgentKind;
  readonly cmdA?: string;
  readonly cmdB?: string;
};

// ---------------------------------------------------------------------------
// Core Ralph types
// ---------------------------------------------------------------------------

export type Story = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly priority: number;
  readonly passes: boolean;
  readonly notes?: string;
};

export type Prd = {
  readonly project: string;
  readonly description: string;
  readonly userStories: ReadonlyArray<Story>;
};

export type QualityGate = {
  readonly name: string;
  readonly cmd: string;
  readonly continueOnFail?: boolean;
};

export type RalphConfig = {
  readonly maxIterations: number;
  readonly qualityGates: ReadonlyArray<QualityGate>;
  readonly delayBetweenIterationsMs: number;
  readonly commitOnPass: boolean;
  readonly promptTemplate?: string;
  readonly requireApprovalBeforeCommit?: boolean;
  readonly maxConsecutiveFailures?: number;
  readonly multiAgent?: MultiAgentConfig;
};

export type GateResult = {
  readonly name: string;
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly passed: boolean;
};

export type IterationResult = {
  readonly iteration: number;
  readonly storyId: string;
  readonly storyTitle: string;
  readonly agentExitCode: number;
  readonly agentStdout?: string;
  readonly gateResults: ReadonlyArray<GateResult>;
  readonly allGatesPassed: boolean;
  readonly committed: boolean;
  readonly completionSignal: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
};

export type TerminationReason =
  | "all_passed"
  | "max_iterations"
  | "completion_signal"
  | "paused"
  | "human_input"
  | "running";

export type RalphState = {
  readonly schema: "macbox.ralph.state.v1";
  readonly prd: Prd;
  readonly config: RalphConfig;
  readonly iterations: ReadonlyArray<IterationResult>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly allStoriesPassed: boolean;
  readonly terminationReason: TerminationReason;
};

export const defaultRalphConfig: RalphConfig = {
  maxIterations: 10,
  qualityGates: [],
  delayBetweenIterationsMs: 2000,
  commitOnPass: true,
};
