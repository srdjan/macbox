import { assert } from "./testutil.ts";
import {
  decideAutoHostProfile,
  hostClaudeWarningMessage,
  hostToolsInfoMessage,
  shouldLinkHostClaude,
} from "../host_profile_policy.ts";

Deno.test("decideAutoHostProfile enables host-claude under HOME by default", () => {
  const d = decideAutoHostProfile({
    effectiveAgent: "claude",
    resolvedAgentPath: "/Users/test/.local/bin/claude",
    homeDir: "/Users/test",
    disableHostClaudeProfile: false,
  });
  assert(d.autoProfile === "host-claude");
  assert(d.logLevel === "warning");
  assert(d.logMessage === hostClaudeWarningMessage);
});

Deno.test("decideAutoHostProfile disables host-claude with --no-host-claude-profile", () => {
  const d = decideAutoHostProfile({
    effectiveAgent: "claude",
    resolvedAgentPath: "/Users/test/.local/bin/claude",
    homeDir: "/Users/test",
    disableHostClaudeProfile: true,
  });
  assert(d.autoProfile === null);
  assert(d.logLevel === null);
  assert(d.logMessage === null);
});

Deno.test("decideAutoHostProfile still enables host-claude outside HOME for Claude", () => {
  const d = decideAutoHostProfile({
    effectiveAgent: "claude",
    resolvedAgentPath: "/opt/homebrew/bin/claude",
    homeDir: "/Users/test",
    disableHostClaudeProfile: false,
  });
  assert(d.autoProfile === "host-claude");
  assert(d.logLevel === "warning");
  assert(d.logMessage === hostClaudeWarningMessage);
});

Deno.test("decideAutoHostProfile enables host-tools for non-Claude agents under HOME", () => {
  const d = decideAutoHostProfile({
    effectiveAgent: "codex",
    resolvedAgentPath: "/Users/test/.local/bin/codex",
    homeDir: "/Users/test",
    disableHostClaudeProfile: true,
  });
  assert(d.autoProfile === "host-tools");
  assert(d.logLevel === "info");
  assert(d.logMessage === hostToolsInfoMessage);
});

Deno.test("shouldLinkHostClaude requires Claude agent and host-claude profile", () => {
  assert(shouldLinkHostClaude("claude", ["agent-claude", "host-claude"]));
  assert(!shouldLinkHostClaude("claude", ["agent-claude"]));
  assert(!shouldLinkHostClaude("codex", ["host-claude"]));
});
