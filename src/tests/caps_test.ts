import { assert } from "./testutil.ts";
import { resolveExecCapability, resolveNetworkCapability } from "../caps.ts";

const mustThrow = (fn: () => void, expected: string) => {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert(msg.includes(expected), `expected '${expected}' in '${msg}'`);
    return;
  }
  throw new Error("expected function to throw");
};

Deno.test("resolveNetworkCapability uses default when no flags are set", () => {
  assert(
    resolveNetworkCapability({
      allowNetwork: undefined,
      blockNetwork: undefined,
      noNetwork: undefined,
      dflt: true,
    }) === true,
  );
  assert(
    resolveNetworkCapability({
      allowNetwork: undefined,
      blockNetwork: undefined,
      noNetwork: undefined,
      dflt: false,
    }) === false,
  );
});

Deno.test("resolveNetworkCapability handles block and no-network flags", () => {
  assert(
    resolveNetworkCapability({
      allowNetwork: undefined,
      blockNetwork: true,
      noNetwork: undefined,
      dflt: true,
    }) === false,
  );
  assert(
    resolveNetworkCapability({
      allowNetwork: undefined,
      blockNetwork: undefined,
      noNetwork: true,
      dflt: true,
    }) === false,
  );
});

Deno.test("resolveNetworkCapability rejects conflicting allow/block flags", () => {
  mustThrow(
    () =>
      resolveNetworkCapability({
        allowNetwork: true,
        blockNetwork: true,
        noNetwork: undefined,
        dflt: true,
      }),
    "either --allow-network or --block-network/--no-network",
  );
});

Deno.test("resolveExecCapability respects block-exec and rejects conflicts", () => {
  assert(
    resolveExecCapability({
      allowExec: undefined,
      blockExec: true,
      dflt: true,
    }) === false,
  );
  mustThrow(
    () =>
      resolveExecCapability({
        allowExec: true,
        blockExec: true,
        dflt: true,
      }),
    "either --allow-exec or --block-exec",
  );
});
