import { assert } from "./testutil.ts";
import { parseSessionId, validateWorktreeName } from "../validate.ts";
import { sessionFileFromId } from "../sessions.ts";
import { worktreeDir } from "../paths.ts";

const mustThrow = async (fn: () => unknown | Promise<unknown>, expected: string) => {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert(msg.includes(expected), `expected error to include '${expected}', got '${msg}'`);
    return;
  }
  throw new Error("expected function to throw");
};

Deno.test("validateWorktreeName allows safe names", () => {
  assert(validateWorktreeName("ai-claude-1") === "ai-claude-1");
  assert(validateWorktreeName("my_feature.test") === "my_feature.test");
});

Deno.test("validateWorktreeName rejects traversal and separators", async () => {
  await mustThrow(() => Promise.resolve(validateWorktreeName("../evil")), "path separators");
  await mustThrow(() => Promise.resolve(validateWorktreeName("a/b")), "path separators");
  await mustThrow(() => Promise.resolve(validateWorktreeName("..")), "invalid");
});

Deno.test("parseSessionId validates strict <repoId/worktreeName> format", async () => {
  const parsed = parseSessionId("abc123def456/worktree-1");
  assert(parsed.repoId === "abc123def456");
  assert(parsed.worktreeName === "worktree-1");

  await mustThrow(() => Promise.resolve(parseSessionId("bad")), "Expected format");
  await mustThrow(() => Promise.resolve(parseSessionId("a/b/c")), "Expected format");
  await mustThrow(() => Promise.resolve(parseSessionId("repo/../x")), "Expected format");
});

Deno.test("path builders reject unsafe session/worktree identifiers", async () => {
  await mustThrow(
    () => Promise.resolve(sessionFileFromId("/tmp/base", "repo/../../outside")),
    "Expected format",
  );
  await mustThrow(
    () => worktreeDir("/tmp/base", "/tmp/repo", "../../escape"),
    "path separators",
  );
});
