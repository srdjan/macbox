import { assert } from "./testutil.ts";
import {
  selectNextStory,
  detectCompletionSignal,
  promptToPrd,
  validatePrd,
  parseRalphConfig,
  buildPrompt,
} from "../ralph.ts";
import type { Prd, Story } from "../ralph_types.ts";
import { defaultRalphConfig } from "../ralph_types.ts";

// ---------------------------------------------------------------------------
// selectNextStory
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

Deno.test("selectNextStory returns null when all stories pass", () => {
  const prd = mkPrd([mkStory("US-001", 1, true), mkStory("US-002", 2, true)]);
  assert(selectNextStory(prd) === null, "expected null");
});

Deno.test("selectNextStory returns the only incomplete story", () => {
  const prd = mkPrd([mkStory("US-001", 1, true), mkStory("US-002", 2, false)]);
  const next = selectNextStory(prd);
  assert(next !== null, "expected a story");
  assert(next!.id === "US-002", "expected US-002");
});

Deno.test("selectNextStory returns highest priority (lowest number) incomplete story", () => {
  const prd = mkPrd([
    mkStory("US-001", 3, false),
    mkStory("US-002", 1, false),
    mkStory("US-003", 2, false),
  ]);
  const next = selectNextStory(prd);
  assert(next !== null, "expected a story");
  assert(next!.id === "US-002", "expected US-002 (priority 1)");
});

Deno.test("selectNextStory skips already-passed stories", () => {
  const prd = mkPrd([
    mkStory("US-001", 1, true),
    mkStory("US-002", 2, false),
    mkStory("US-003", 3, false),
  ]);
  const next = selectNextStory(prd);
  assert(next!.id === "US-002", "expected US-002 (highest priority incomplete)");
});

Deno.test("selectNextStory returns null for empty story list", () => {
  const prd = mkPrd([]);
  assert(selectNextStory(prd) === null, "expected null for empty list");
});

// ---------------------------------------------------------------------------
// detectCompletionSignal
// ---------------------------------------------------------------------------

Deno.test("detectCompletionSignal returns true when signal present", () => {
  assert(
    detectCompletionSignal("All done. <promise>COMPLETE</promise> goodbye."),
    "expected true",
  );
});

Deno.test("detectCompletionSignal returns false when signal absent", () => {
  assert(!detectCompletionSignal("All done. goodbye."), "expected false");
});

Deno.test("detectCompletionSignal returns false for empty string", () => {
  assert(!detectCompletionSignal(""), "expected false for empty");
});

Deno.test("detectCompletionSignal returns false for partial match", () => {
  assert(!detectCompletionSignal("<promise>COMPLE</promise>"), "expected false for partial");
});

// ---------------------------------------------------------------------------
// promptToPrd
// ---------------------------------------------------------------------------

Deno.test("promptToPrd creates single-story PRD", () => {
  const prd = promptToPrd("Add a search feature");
  assert(prd.project === "ad-hoc", "expected ad-hoc project");
  assert(prd.userStories.length === 1, "expected 1 story");
  assert(prd.userStories[0].id === "US-001", "expected US-001");
  assert(prd.userStories[0].passes === false, "expected not passed");
  assert(prd.userStories[0].priority === 1, "expected priority 1");
});

Deno.test("promptToPrd truncates long titles", () => {
  const longPrompt = "A".repeat(100);
  const prd = promptToPrd(longPrompt);
  assert(prd.userStories[0].title.length <= 80, "expected truncated title");
  assert(prd.userStories[0].title.endsWith("..."), "expected ellipsis");
});

Deno.test("promptToPrd keeps short titles intact", () => {
  const prd = promptToPrd("Short prompt");
  assert(prd.userStories[0].title === "Short prompt", "expected exact title");
});

// ---------------------------------------------------------------------------
// validatePrd
// ---------------------------------------------------------------------------

Deno.test("validatePrd accepts valid PRD", () => {
  const raw = {
    project: "myproject",
    description: "A project",
    userStories: [
      {
        id: "US-001",
        title: "First story",
        description: "Do something",
        acceptanceCriteria: ["It works"],
        priority: 1,
        passes: false,
      },
    ],
  };
  const prd = validatePrd(raw);
  assert(prd.project === "myproject", "expected project name");
  assert(prd.userStories.length === 1, "expected 1 story");
  assert(prd.userStories[0].id === "US-001", "expected story id");
});

Deno.test("validatePrd rejects non-object", () => {
  let threw = false;
  try {
    validatePrd("not an object");
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("must be an object"), "expected object error");
  }
  assert(threw, "expected error");
});

Deno.test("validatePrd rejects empty stories array", () => {
  let threw = false;
  try {
    validatePrd({ project: "x", userStories: [] });
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("non-empty"), "expected non-empty error");
  }
  assert(threw, "expected error");
});

Deno.test("validatePrd rejects story without title", () => {
  let threw = false;
  try {
    validatePrd({
      project: "x",
      userStories: [{ id: "US-001", description: "no title" }],
    });
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("missing title"), "expected missing title error");
  }
  assert(threw, "expected error");
});

Deno.test("validatePrd auto-assigns id and priority when missing", () => {
  const prd = validatePrd({
    project: "x",
    userStories: [
      { title: "First" },
      { title: "Second" },
    ],
  });
  assert(prd.userStories[0].id === "US-001", "expected auto id");
  assert(prd.userStories[0].priority === 1, "expected auto priority 1");
  assert(prd.userStories[1].id === "US-002", "expected auto id 2");
  assert(prd.userStories[1].priority === 2, "expected auto priority 2");
});

Deno.test("validatePrd defaults passes to false", () => {
  const prd = validatePrd({
    project: "x",
    userStories: [{ title: "Story" }],
  });
  assert(prd.userStories[0].passes === false, "expected passes false");
});

// ---------------------------------------------------------------------------
// parseRalphConfig
// ---------------------------------------------------------------------------

Deno.test("parseRalphConfig returns defaults for null/undefined", () => {
  const cfg = parseRalphConfig(null);
  assert(cfg.maxIterations === defaultRalphConfig.maxIterations, "expected default maxIterations");
  assert(cfg.qualityGates.length === 0, "expected no gates");
  assert(cfg.commitOnPass === true, "expected commitOnPass true");
});

Deno.test("parseRalphConfig returns defaults for empty object", () => {
  const cfg = parseRalphConfig({});
  assert(cfg.maxIterations === defaultRalphConfig.maxIterations, "expected default maxIterations");
});

Deno.test("parseRalphConfig overrides maxIterations", () => {
  const cfg = parseRalphConfig({ maxIterations: 5 });
  assert(cfg.maxIterations === 5, "expected 5");
});

Deno.test("parseRalphConfig ignores invalid maxIterations", () => {
  const cfg = parseRalphConfig({ maxIterations: -1 });
  assert(cfg.maxIterations === defaultRalphConfig.maxIterations, "expected default for negative");
});

Deno.test("parseRalphConfig parses quality gates", () => {
  const cfg = parseRalphConfig({
    qualityGates: [
      { name: "typecheck", cmd: "npx tsc --noEmit" },
      { name: "lint", cmd: "npx eslint src/", continueOnFail: true },
    ],
  });
  assert(cfg.qualityGates.length === 2, "expected 2 gates");
  assert(cfg.qualityGates[0].name === "typecheck", "expected typecheck");
  assert(cfg.qualityGates[1].continueOnFail === true, "expected continueOnFail");
});

Deno.test("parseRalphConfig skips invalid gate entries", () => {
  const cfg = parseRalphConfig({
    qualityGates: [
      { name: "valid", cmd: "echo ok" },
      { name: "no-cmd" },
      "not-an-object",
    ],
  });
  assert(cfg.qualityGates.length === 1, "expected 1 valid gate");
});

Deno.test("parseRalphConfig overrides commitOnPass", () => {
  const cfg = parseRalphConfig({ commitOnPass: false });
  assert(cfg.commitOnPass === false, "expected false");
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

Deno.test("buildPrompt includes story details", () => {
  const story = mkStory("US-001", 1, false);
  const prd = mkPrd([story, mkStory("US-002", 2, false)]);
  const prompt = buildPrompt(prd, story, "", 1, defaultRalphConfig);
  assert(prompt.includes("US-001"), "expected story id");
  assert(prompt.includes("Story US-001"), "expected story title");
  assert(prompt.includes("iteration 1 of 10"), "expected iteration count");
});

Deno.test("buildPrompt includes PRD overview", () => {
  const stories = [
    mkStory("US-001", 1, true),
    mkStory("US-002", 2, false),
    mkStory("US-003", 3, false),
  ];
  const prd = mkPrd(stories);
  const prompt = buildPrompt(prd, stories[1], "", 2, defaultRalphConfig);
  assert(prompt.includes("1/3"), "expected passed count");
  assert(prompt.includes("US-002"), "expected remaining story");
  assert(prompt.includes("US-003"), "expected remaining story");
});

Deno.test("buildPrompt includes progress from previous iterations", () => {
  const story = mkStory("US-001", 1, false);
  const prd = mkPrd([story]);
  const progress = "## Iteration 1\nDid some work\n---\n";
  const prompt = buildPrompt(prd, story, progress, 2, defaultRalphConfig);
  assert(prompt.includes("Did some work"), "expected progress content");
});

Deno.test("buildPrompt shows 'No previous iterations' when progress is empty", () => {
  const story = mkStory("US-001", 1, false);
  const prd = mkPrd([story]);
  const prompt = buildPrompt(prd, story, "", 1, defaultRalphConfig);
  assert(prompt.includes("No previous iterations"), "expected no-progress message");
});

Deno.test("buildPrompt includes quality gate list", () => {
  const story = mkStory("US-001", 1, false);
  const prd = mkPrd([story]);
  const config = parseRalphConfig({
    qualityGates: [{ name: "test", cmd: "npm test" }],
  });
  const prompt = buildPrompt(prd, story, "", 1, config);
  assert(prompt.includes("test: npm test"), "expected gate in prompt");
});

Deno.test("buildPrompt shows '(none configured)' when no gates", () => {
  const story = mkStory("US-001", 1, false);
  const prd = mkPrd([story]);
  const prompt = buildPrompt(prd, story, "", 1, defaultRalphConfig);
  assert(prompt.includes("(none configured)"), "expected no-gates message");
});

Deno.test("buildPrompt includes completion signal instructions", () => {
  const story = mkStory("US-001", 1, false);
  const prd = mkPrd([story]);
  const prompt = buildPrompt(prd, story, "", 1, defaultRalphConfig);
  assert(prompt.includes("<promise>COMPLETE</promise>"), "expected completion signal instruction");
});
