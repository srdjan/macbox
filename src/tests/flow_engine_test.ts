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

// --- Step output capture tests ---

Deno.test("step outputs: shell step captures stdout as outputs.result", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "greet", type: "steps:shell", args: { cmd: "echo hello-world" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-outputs-basic",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[0].outputs.result === "hello-world", "expected outputs.result to be trimmed stdout");
  });
});

Deno.test("step outputs: failed step has empty outputs", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "bad", type: "steps:shell" },
      ],
    };

    const result = await runFlow({
      flowName: "test-outputs-error",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === false, "expected not ok");
    assert(Object.keys(result.steps[0].outputs).length === 0, "expected empty outputs on error");
  });
});

Deno.test("step outputs: non-zero exit still captures stdout", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "partial", type: "steps:shell", args: { cmd: "echo partial-output; exit 1" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-outputs-nonzero",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === false, "expected not ok");
    assert(result.steps[0].exitCode === 1, "expected exit 1");
    assert(result.steps[0].outputs.result === "partial-output", "expected outputs.result even on non-zero exit");
  });
});

// --- Interpolation tests ---

Deno.test("interpolation: downstream step references upstream outputs.result", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "produce", type: "steps:shell", args: { cmd: "echo my-value" } },
        { id: "consume", type: "steps:shell", args: { cmd: "echo got:${steps.produce.outputs.result}" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-outputs",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[1].outputs.result === "got:my-value", "expected interpolated value in downstream output");
  });
});

Deno.test("interpolation: reference to stdout directly", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "src", type: "steps:shell", args: { cmd: "printf 'raw'" } },
        { id: "dst", type: "steps:shell", args: { cmd: "echo got:${steps.src.stdout}" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-stdout",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[1].outputs.result === "got:raw", "expected raw stdout interpolation");
  });
});

Deno.test("interpolation: reference to exitCode", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "check", type: "steps:shell", args: { cmd: "exit 0" }, continueOnError: true },
        { id: "report", type: "steps:shell", args: { cmd: "echo code:${steps.check.exitCode}" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-exitcode",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[1].outputs.result === "code:0", "expected exitCode interpolation");
  });
});

Deno.test("interpolation: missing step reference resolves to empty string", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "use", type: "steps:shell", args: { cmd: "echo val:[${steps.nonexistent.outputs.result}]" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-missing",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[0].outputs.result === "val:[]", "expected empty string for missing ref");
  });
});

Deno.test("interpolation: missing output key resolves to empty string", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "src", type: "steps:shell", args: { cmd: "echo exists" } },
        { id: "use", type: "steps:shell", args: { cmd: "echo val:[${steps.src.outputs.nokey}]" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-missing-key",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[1].outputs.result === "val:[]", "expected empty string for missing output key");
  });
});

Deno.test("interpolation: no args means no interpolation needed", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "no-args", type: "steps:shell" },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-no-args",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    // Should fail because shell requires args.cmd, but should not crash on interpolation
    assert(result.ok === false, "expected not ok");
    assert(result.steps[0].error?.includes("requires args.cmd"), "expected args.cmd error");
  });
});

Deno.test("interpolation: chained steps pass values through", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "a", type: "steps:shell", args: { cmd: "echo alpha" } },
        { id: "b", type: "steps:shell", args: { cmd: "echo ${steps.a.outputs.result}-beta" } },
        { id: "c", type: "steps:shell", args: { cmd: "echo ${steps.b.outputs.result}-gamma" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-chain",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[0].outputs.result === "alpha", "expected step a output");
    assert(result.steps[1].outputs.result === "alpha-beta", "expected step b chained output");
    assert(result.steps[2].outputs.result === "alpha-beta-gamma", "expected step c chained output");
  });
});

Deno.test("interpolation: multiple refs in single string", async () => {
  await withTempDir(async (dir) => {
    const flowDef: FlowDef = {
      steps: [
        { id: "x", type: "steps:shell", args: { cmd: "echo one" } },
        { id: "y", type: "steps:shell", args: { cmd: "echo two" } },
        { id: "z", type: "steps:shell", args: { cmd: "echo ${steps.x.outputs.result}+${steps.y.outputs.result}" } },
      ],
    };

    const result = await runFlow({
      flowName: "test-interpolate-multi",
      flowDef,
      worktreePath: dir,
      repoRoot: dir,
      gitCommonDir: `${dir}/.git`,
      gitDir: `${dir}/.git`,
    });

    assert(result.ok === true, "expected ok");
    assert(result.steps[2].outputs.result === "one+two", "expected both refs interpolated");
  });
});
