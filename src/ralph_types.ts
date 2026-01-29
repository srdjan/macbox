// Ralph autonomous loop types.
// No runtime logic - only type exports and defaults.

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
