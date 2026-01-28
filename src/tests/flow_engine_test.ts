import { assert } from "./testutil.ts";
import { runFlow } from "../flow_engine.ts";
import type { FlowDef } from "../flow_config.ts";

const withTempDir = async (fn: (dir: string) => Promise<void>) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "macbox-flow-eng-" });
  try {
    await fn(tmpDir);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
};

// These tests use steps:shell which runs without sandbox (direct bash -lc).
// This avoids needing a full worktree/sandbox setup.

Deno.test("runFlow executes shell steps sequentially", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "echo1", type: "steps:shell", args: { cmd: "echo first" } },
        { id: "echo2", type: "steps:shell", args: { cmd: "echo second" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-sequential",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps.length === 2, "expected 2 step results");
    assert(result.steps[0].exitCode === 0, "expected step 1 success");
    assert(result.steps[0].stdout?.includes("first"), "expected 'first' in stdout");
    assert(result.steps[1].exitCode === 0, "expected step 2 success");
    assert(result.steps[1].stdout?.includes("second"), "expected 'second' in stdout");
  });
});

Deno.test("runFlow halts on failure by default", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "fail", type: "steps:shell", args: { cmd: "exit 42" } },
        { id: "never", type: "steps:shell", args: { cmd: "echo should-not-run" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-halt",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === false, "expected not ok");
    assert(result.steps.length === 1, "expected only 1 step (halted before second)");
    assert(result.steps[0].exitCode === 42, "expected exit code 42");
  });
});

Deno.test("runFlow continues on error when continueOnError is set", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "fail", type: "steps:shell", args: { cmd: "exit 1" }, continueOnError: true },
        { id: "after", type: "steps:shell", args: { cmd: "echo continued" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-continue",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === false, "expected not ok (step 1 failed)");
    assert(result.steps.length === 2, "expected 2 steps (continued past failure)");
    assert(result.steps[0].exitCode === 1, "expected step 1 failure");
    assert(result.steps[1].exitCode === 0, "expected step 2 success");
    assert(result.steps[1].stdout?.includes("continued"), "expected 'continued' in stdout");
  });
});

Deno.test("runFlow handles unknown step type", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "bad", type: "steps:nonexistent" },
      ],
    };

    const result = await runFlow({
      flowName: "test-unknown",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === false, "expected not ok");
    assert(result.steps.length === 1, "expected 1 step");
    assert(result.steps[0].error?.includes("unknown step type"), "expected unknown type error");
  });
});

Deno.test("runFlow handles missing cmd arg for shell step", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "no-cmd", type: "steps:shell" },
      ],
    };

    const result = await runFlow({
      flowName: "test-no-cmd",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === false, "expected not ok");
    assert(result.steps[0].error?.includes("requires args.cmd"), "expected args.cmd error");
  });
});

Deno.test("runFlow persists result to .macbox/flows/", async () => {
  await withTempDir(async (dir) => {
    // Create .macbox dir
    await Deno.mkdir(`${dir}/.macbox`, { recursive: true });

    const flowDef: FlowDef = {
      steps: [
        { id: "ok", type: "steps:shell", args: { cmd: "echo persisted" } },
      ],
    };

    await runFlow({
      flowName: "test-persist",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    // Check that a result file was written
    let found = false;
    for await (const ent of Deno.readDir(`${dir}/.macbox/flows`)) {
      if (ent.name.startsWith("test-persist-") && ent.name.endsWith(".json")) {
        found = true;
        const content = JSON.parse(await Deno.readTextFile(`${dir}/.macbox/flows/${ent.name}`));
        assert(content.schema === "macbox.flow.result.v1", "expected result schema");
        assert(content.flowName === "test-persist", "expected flow name in result");
        assert(content.ok === true, "expected ok in result");
      }
    }
    assert(found, "expected flow result file");
  });
});

Deno.test("runFlow includes timing info", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "timed", type: "steps:shell", args: { cmd: "echo timing" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-timing",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.startedAt.length > 0, "expected startedAt");
    assert(result.completedAt.length > 0, "expected completedAt");
    assert(result.steps[0].startedAt.length > 0, "expected step startedAt");
    assert(result.steps[0].completedAt.length > 0, "expected step completedAt");
  });
});
