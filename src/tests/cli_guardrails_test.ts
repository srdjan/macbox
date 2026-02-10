import { cleanCmd } from "../clean.ts";
import { presetsCmd } from "../presets_cmd.ts";
import { profilesCmd } from "../profiles_cmd.ts";
import { sessionsCmd } from "../sessions_cmd.ts";
import { workspaceCmd } from "../workspace_cmd.ts";
import { assert } from "./testutil.ts";

const captureStdout = async (fn: () => Promise<unknown>): Promise<string> => {
  const lines: string[] = [];
  const prev = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((x) => String(x)).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = prev;
  }
  return lines.join("\n");
};

const parseJson = (s: string): Record<string, unknown> => JSON.parse(s);

Deno.test("workspace new --help short-circuits safely", async () => {
  const out = await captureStdout(async () => {
    const res = await workspaceCmd(["new", "--help"]);
    assert(res.code === 0, "expected success exit for help");
  });
  assert(
    out.includes("macbox workspace new"),
    "expected subcommand-specific workspace new usage",
  );
});

Deno.test("workspace help <subcommand> shows targeted usage", async () => {
  const out = await captureStdout(async () => {
    const res = await workspaceCmd(["help", "open"]);
    assert(res.code === 0, "expected success exit for help");
  });
  assert(
    out.includes("macbox workspace open <id>"),
    "expected workspace open usage",
  );
});

Deno.test("sessions show --help shows targeted usage", async () => {
  const out = await captureStdout(async () => {
    const res = await sessionsCmd(["show", "--help"]);
    assert(res.code === 0, "expected success exit for help");
  });
  assert(
    out.includes("macbox sessions show <id|worktreeName|latest>"),
    "expected sessions show usage",
  );
});

Deno.test("sessions show --help --json returns usage schema", async () => {
  const out = await captureStdout(async () => {
    const res = await sessionsCmd(["show", "--help", "--json"]);
    assert(res.code === 0, "expected success exit for help");
  });
  const parsed = parseJson(out);
  assert(
    parsed.schema === "macbox.sessions.usage.v1",
    "expected sessions usage schema",
  );
  assert(
    parsed.subcommand === "show",
    "expected sessions subcommand in usage output",
  );
});

Deno.test("presets show --help shows targeted usage", async () => {
  const out = await captureStdout(async () => {
    const res = await presetsCmd(["show", "--help"]);
    assert(res.code === 0, "expected success exit for help");
  });
  assert(
    out.includes("macbox presets show <name>"),
    "expected presets show usage",
  );
});

Deno.test("presets show --help --json returns usage schema", async () => {
  const out = await captureStdout(async () => {
    const res = await presetsCmd(["show", "--help", "--json"]);
    assert(res.code === 0, "expected success exit for help");
  });
  const parsed = parseJson(out);
  assert(
    parsed.schema === "macbox.presets.usage.v1",
    "expected presets usage schema",
  );
  assert(
    parsed.subcommand === "show",
    "expected presets subcommand in usage output",
  );
});

Deno.test("profiles show --help shows targeted usage", async () => {
  const out = await captureStdout(async () => {
    const res = await profilesCmd(["show", "--help"]);
    assert(res.code === 0, "expected success exit for help");
  });
  assert(
    out.includes("macbox profiles show <name>"),
    "expected profiles show usage",
  );
});

Deno.test("profiles show --help --json returns usage schema", async () => {
  const out = await captureStdout(async () => {
    const res = await profilesCmd(["show", "--help", "--json"]);
    assert(res.code === 0, "expected success exit for help");
  });
  const parsed = parseJson(out);
  assert(
    parsed.schema === "macbox.profiles.usage.v1",
    "expected profiles usage schema",
  );
  assert(
    parsed.subcommand === "show",
    "expected profiles subcommand in usage output",
  );
});

Deno.test("workspace new --help returns success", async () => {
  const res = await workspaceCmd(["new", "--help"]);
  assert(res.code === 0, "expected success exit for help");
});

Deno.test("workspace new validates --issue format strictly", async () => {
  let msg = "";
  try {
    await workspaceCmd(["new", "--issue", "123abc"]);
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err);
  }
  assert(
    msg.includes("macbox: --issue must be an integer"),
    "expected strict integer validation error",
  );
});

Deno.test("clean --help does not execute cleanup flow", async () => {
  const res = await cleanCmd(["--help"]);
  assert(res.code === 0, "expected success exit for help");
});

Deno.test("clean --help --json returns usage schema", async () => {
  const out = await captureStdout(async () => {
    const res = await cleanCmd(["--help", "--json"]);
    assert(res.code === 0, "expected success exit for help");
  });
  const parsed = parseJson(out);
  assert(
    parsed.schema === "macbox.clean.usage.v1",
    "expected clean usage schema",
  );
});

Deno.test("clean requires --worktree or --all before repo detection", async () => {
  let msg = "";
  try {
    await cleanCmd([]);
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err);
  }
  assert(
    msg.includes("clean: specify --worktree <name> or --all"),
    "expected missing selector guidance",
  );
});
