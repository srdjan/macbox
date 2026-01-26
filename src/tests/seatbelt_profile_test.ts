import { seatbeltProfile } from "../seatbelt.ts";
import { assert } from "./testutil.ts";

Deno.test("seatbelt profile includes required ops", () => {
  const s = seatbeltProfile({
    worktree: "/tmp/wt",
    gitCommonDir: "/tmp/gc",
    gitDir: "/tmp/gd",
    debug: true,
    network: true,
    exec: true,
  });
  assert(s.includes("(deny default)"));
  assert(s.includes("(allow process*)"));
  assert(s.includes("(deny file-write*)"));
  assert(s.includes("(allow file-write*"));
  assert(s.includes("(allow network-outbound)"));
  assert(s.includes("(allow system-socket)"));
});
