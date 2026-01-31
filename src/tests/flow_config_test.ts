import { assert } from "./testutil.ts";
import { loadMacboxConfig, emptyConfig } from "../flow_config.ts";
import { pathJoin } from "../os.ts";

const withTempDir = async (fn: (dir: string) => Promise<void>) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "macbox-flow-cfg-" });
  try {
    await fn(tmpDir);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
};

Deno.test("loadMacboxConfig returns null when no file exists", async () => {
  await withTempDir(async (dir) => {
    const config = await loadMacboxConfig(dir);
    assert(config === null, "expected null");
  });
});

Deno.test("loadMacboxConfig loads valid config", async () => {
  await withTempDir(async (dir) => {
    const configData = {
      flows: {
        review: {
          description: "Review code changes",
          steps: [
            { id: "diff", type: "steps:git.diff" },
            { id: "status", type: "steps:git.status" },
          ],
        },
      },
      defaults: {
        agent: "claude",
        profiles: ["host-tools"],
      },
    };
    await Deno.writeTextFile(
      pathJoin(dir, "macbox.json"),
      JSON.stringify(configData),
    );

    const config = await loadMacboxConfig(dir);
    assert(config !== null, "expected config");
    assert(config!.schema === "macbox.config.v1", "expected schema");
    assert(config!.flows !== undefined, "expected flows");
    assert(config!.flows!["review"] !== undefined, "expected review flow");
    assert(config!.flows!["review"].steps.length === 2, "expected 2 steps");
    assert(config!.flows!["review"].description === "Review code changes", "expected description");
    assert(config!.defaults?.agent === "claude", "expected default agent");
    assert(config!.defaults?.profiles?.length === 1, "expected 1 default profile");
  });
});

Deno.test("loadMacboxConfig rejects flow with no steps", async () => {
  await withTempDir(async (dir) => {
    const configData = {
      flows: {
        empty: { steps: [] },
      },
    };
    await Deno.writeTextFile(
      pathJoin(dir, "macbox.json"),
      JSON.stringify(configData),
    );

    let threw = false;
    try {
      await loadMacboxConfig(dir);
    } catch (e) {
      threw = true;
      assert(
        (e as Error).message.includes("has no steps"),
        "expected 'has no steps' error",
      );
    }
    assert(threw, "expected error for empty flow");
  });
});

Deno.test("loadMacboxConfig rejects step without type", async () => {
  await withTempDir(async (dir) => {
    const configData = {
      flows: {
        bad: { steps: [{ id: "x" }] },
      },
    };
    await Deno.writeTextFile(
      pathJoin(dir, "macbox.json"),
      JSON.stringify(configData),
    );

    let threw = false;
    try {
      await loadMacboxConfig(dir);
    } catch (e) {
      threw = true;
      assert(
        (e as Error).message.includes("missing 'type'"),
        "expected 'missing type' error",
      );
    }
    assert(threw, "expected error for missing type");
  });
});

Deno.test("loadMacboxConfig auto-assigns step ids", async () => {
  await withTempDir(async (dir) => {
    const configData = {
      flows: {
        test: {
          steps: [
            { type: "steps:shell", args: { cmd: "echo hi" } },
          ],
        },
      },
    };
    await Deno.writeTextFile(
      pathJoin(dir, "macbox.json"),
      JSON.stringify(configData),
    );

    const config = await loadMacboxConfig(dir);
    assert(config !== null, "expected config");
    assert(config!.flows!["test"].steps[0].id === "step-0", "expected auto-assigned id");
  });
});

Deno.test("loadMacboxConfig falls back to repo root", async () => {
  await withTempDir(async (worktreeDir) => {
    await withTempDir(async (repoDir) => {
      const configData = {
        flows: {
          build: { steps: [{ id: "b", type: "steps:shell", args: { cmd: "make" } }] },
        },
      };
      await Deno.writeTextFile(
        pathJoin(repoDir, "macbox.json"),
        JSON.stringify(configData),
      );

      // Worktree has no macbox.json, repo root does
      const config = await loadMacboxConfig(worktreeDir, repoDir);
      assert(config !== null, "expected config from repo root fallback");
      assert(config!.flows!["build"] !== undefined, "expected build flow");
    });
  });
});

Deno.test("emptyConfig returns valid empty config", () => {
  const cfg = emptyConfig();
  assert(cfg.schema === "macbox.config.v1", "expected schema");
  assert(cfg.flows === undefined, "expected no flows");
});

Deno.test("loadMacboxConfig handles continueOnError", async () => {
  await withTempDir(async (dir) => {
    const configData = {
      flows: {
        test: {
          steps: [
            { id: "a", type: "steps:shell", args: { cmd: "echo a" }, continueOnError: true },
            { id: "b", type: "steps:shell", args: { cmd: "echo b" } },
          ],
        },
      },
    };
    await Deno.writeTextFile(
      pathJoin(dir, "macbox.json"),
      JSON.stringify(configData),
    );

    const config = await loadMacboxConfig(dir);
    assert(config!.flows!["test"].steps[0].continueOnError === true, "expected continueOnError true");
    assert(config!.flows!["test"].steps[1].continueOnError === undefined, "expected continueOnError undefined");
  });
});
