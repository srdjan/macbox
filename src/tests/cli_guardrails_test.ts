import { cleanCmd } from "../clean.ts";
import { workspaceCmd } from "../workspace_cmd.ts";
import { assert } from "./testutil.ts";

Deno.test("workspace new --help short-circuits safely", async () => {
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
