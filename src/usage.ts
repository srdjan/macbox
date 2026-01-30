export const printMinimalHelp = () => {
  const s = `
macbox - run AI agents in a native macOS sandbox

Usage:
  macbox --prompt <text> [options] [-- <agent args>]   pipe mode (runs prompt, then exits)
  macbox --ralph <prd-path> [options]                  autonomous mode

  One of --prompt or --ralph is required.
  Agent is resolved from: preset > macbox.json defaults > auto-detect.

Examples:
  macbox --prompt "fix the build"
  macbox --prompt "refactor auth" --preset fullstack-typescript
  macbox --ralph prd.json
  macbox --ralph "Add a search endpoint"

  macbox --help-all    show all commands (presets, profiles, sessions, ...)
`;
  console.log(s.trim());
};

export const printHelp = () => {
  const s = `
macbox - run AI agents in a native macOS sandbox (Seatbelt) using git worktrees

Usage:
  macbox --prompt <text> [options] [-- <agent args>]   pipe mode (runs prompt, then exits)
  macbox --ralph <prd-path> [options]                  autonomous mode

  One of --prompt or --ralph is required.
  Agent is resolved from: preset > macbox.json defaults > project defaults > auto-detect.
  Authentication is automatic on first use.
  Everything after -- is passed directly to the agent.

  --ralph accepts a path to prd.json or a free-form prompt string.
  When --ralph is set, additional flags apply: --gate, --max-iterations, --no-commit,
    --resume, --require-approval, --max-failures, --multi-agent, --agent-a, --agent-b.

  Advanced flags (not shown in basic help):
    [--preset <name>] [--profile <name[,name2...]>] [--worktree <name>] [--branch <branch>]
    [--cmd <path>] [--session <latest|worktreeName|repoId/worktreeName>]
    [--allow-network|--block-network] [--allow-exec|--block-exec]
    [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>]
    [--debug] [--trace] [--json] [--repo <path>] [--base <path>]

Management commands:
  macbox skills list [--json] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills describe <name> [--json] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills registry [--json] [--write] [--committed] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills contract [--json]
  macbox skills path <name> [--file <skill.json|run.ts|README.md|dir>] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills edit <name> [--file <...>] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills init <name> [--local] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills run  <name> [--json] [--capture] [--result <path>] [--worktree <name>] [--session <ref>]
               [--profile <name[,name2...]>] [--allow-network|--block-network] [--allow-exec|--block-exec]
               [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]
               [--repo <path>] [--base <path>] -- <skill args...>

  macbox sessions list [--repo <path>] [--base <path>]
  macbox sessions show <id|worktreeName|latest> [--repo <path>] [--base <path>]
  macbox sessions delete <id|worktreeName> [--repo <path>] [--base <path>]
  macbox sessions clean [--all] [--repo <path>] [--base <path>]

  macbox clean [--worktree <name> | --all] [--repo <path>] [--base <path>]

  macbox profiles list
  macbox profiles show <name>

  macbox presets list
  macbox presets show <name>
  macbox presets create <name> [--template <preset>]
  macbox presets edit <name>
  macbox presets delete <name>

  macbox project add [--name <alias>] [--repo <path>] [--preset <name>]
  macbox project list
  macbox project show <name>
  macbox project remove <name>

  macbox workspace new [--issue N] [--name <label>] [--preset <name>]
                       [--branch <start-point>] [--worktree <name>] [--repo <path>] [--base <path>]
  macbox workspace list [--all] [--archived] [--repo <path>] [--base <path>]
  macbox workspace show <id> [--base <path>]
  macbox workspace open <id> [--base <path>]
  macbox workspace archive <id> [--base <path>]
  macbox workspace restore <id> [--base <path>]

  macbox flow run <name> [--workspace <id>] [--worktree <name>] [--json] [--debug] [--repo <path>] [--base <path>]
  macbox flow list [--worktree <name>] [--repo <path>] [--base <path>]
  macbox flow show <name> [--worktree <name>] [--repo <path>] [--base <path>]

  macbox context pack [--workspace <id>] [--worktree <name>] [--summary <text>] [--repo <path>] [--base <path>]
  macbox context show <packId> [--workspace <id>] [--worktree <name>] [--repo <path>] [--base <path>]
  macbox context list [--workspace <id>] [--worktree <name>] [--repo <path>] [--base <path>]

Notes:
  - Authentication is automatic: macbox checks for credentials on first use
    and runs the agent's setup flow if needed.
  - Agent is determined by: preset config > macbox.json defaults.agent > project defaults > auto-detect.
    Configure in macbox.json: { "defaults": { "preset": "my-preset" } }
  - Bundled profiles (agent-claude, agent-codex) are auto-applied based on the resolved agent.
  - Presets bundle agent, profiles, capabilities, and environment.
    Built-in presets: fullstack-typescript, python-ml, rust-dev, ralph-typescript, ralph-multi-agent
    User presets: ~/.config/macbox/presets/*.json
  - Uses /usr/bin/sandbox-exec to apply a Seatbelt sandbox profile.
  - --trace writes sandbox denial logs to: <worktree>/.macbox/logs/sandbox-violations.log
  - --profile composes additional read/write allowlists into the sandbox profile.
    Built-ins: <repo>/profiles/*.json
    User profiles: ~/.config/macbox/profiles/*.json
  - Creates worktrees under: <base>/worktrees/<repoId>/<worktree>
  - Agent HOME/caches/tmp live under: <worktree>/.macbox/
  - Projects register repos for multi-repo awareness.
    Registry: ~/.config/macbox/projects.json
  - Workspaces wrap a (project, worktree, session) into a managed lifecycle.
    Alias: 'macbox ws' is shorthand for 'macbox workspace'.
  - Flows are named step sequences defined in macbox.json at the repo root.
  - Ralph is an autonomous loop over a PRD. Use --ralph <prd.json> or --ralph "prompt".
    State is saved to .macbox/ralph/.

Examples:
  macbox --prompt "fix the build"
  macbox --prompt "refactor auth" --preset fullstack-typescript
  macbox --ralph prd.json --gate "test:deno test -A"
  macbox --ralph "Add a search endpoint"
  macbox presets list
  macbox presets show fullstack-typescript
  macbox profiles list
  macbox sessions list --repo .
  macbox clean --worktree ai-claude-1
  macbox workspace new --issue 42
  macbox workspace list
  macbox flow run build
`;
  console.log(s.trim());
};
