export const printMinimalHelp = () => {
  const s = `
macbox - run AI agents in a native macOS sandbox

Usage:
  macbox --prompt <text> [options] [-- <agent args>]

  --prompt is required.
  Agent is resolved from: preset > macbox.json defaults > auto-detect.

Examples:
  macbox --prompt "fix the build"
  macbox --prompt "refactor auth" --preset fullstack-typescript

  macbox --help-all    show all commands (profiles, sessions, workspaces, ...)
`;
  console.log(s.trim());
};

export const printHelp = () => {
  const s = `
macbox - run AI agents in a native macOS sandbox (Seatbelt) using git worktrees

Usage:
  macbox --prompt <text> [options] [-- <agent args>]

  --prompt is required.
  Agent is resolved from: preset > macbox.json defaults > auto-detect.
  Authentication is automatic on first use.
  Everything after -- is passed directly to the agent.

  Advanced flags (not shown in basic help):
    [--preset <name>] [--profile <name[,name2...]>] [--worktree <name>] [--branch <branch>]
    [--cmd <path>] [--session <latest|worktreeName|repoId/worktreeName>]
    [--allow-network|--block-network] [--allow-exec|--block-exec]
    [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>]
    [--no-host-claude-profile] [--debug] [--trace] [--repo <path>] [--base <path>]

Management commands:
  macbox sessions list [--repo <path>] [--base <path>]
  macbox sessions show <id|worktreeName|latest> [--repo <path>] [--base <path>]
  macbox sessions delete <id|worktreeName> [--repo <path>] [--base <path>]
  macbox sessions clean [--all] [--repo <path>] [--base <path>]

  macbox clean [--worktree <name> | --all] [--repo <path>] [--base <path>]

  macbox profiles list
  macbox profiles show <name>

  macbox presets list
  macbox presets show <name>

  macbox workspace new [--name <label>] [--preset <name>]
                       [--branch <start-point>] [--worktree <name>] [--repo <path>] [--base <path>]
  macbox workspace list [--repo <path>] [--base <path>]
  macbox workspace show <id> [--base <path>]
  macbox workspace open <id> [--base <path>]

Notes:
  - Authentication is automatic: macbox checks for credentials on first use
    and runs the agent's setup flow if needed.
  - Agent is determined by: preset config > macbox.json defaults.agent > auto-detect.
    Configure in macbox.json: { "defaults": { "preset": "my-preset" } }
  - Bundled profiles (agent-claude, agent-codex) are auto-applied based on the resolved agent.
  - Claude runs auto-enable host-claude by default (grants ~/.claude read/write for auth/session state).
    Use --no-host-claude-profile to opt out.
  - Presets bundle agent, profiles, capabilities, and environment.
    Built-in preset: fullstack-typescript
    User presets: ~/.config/macbox/presets/*.json
  - Uses /usr/bin/sandbox-exec to apply a Seatbelt sandbox profile.
  - --trace writes sandbox denial logs to: <worktree>/.macbox/logs/sandbox-violations.log
  - --profile composes additional read/write allowlists into the sandbox profile.
    Built-ins: <repo>/profiles/*.json
    User profiles: ~/.config/macbox/profiles/*.json
  - Creates worktrees under: <base>/worktrees/<repoId>/<worktree>
  - Agent HOME/caches/tmp live under: <worktree>/.macbox/
  - Workspaces provide named worktrees with associated session metadata.
    Alias: 'macbox ws' is shorthand for 'macbox workspace'.
  - For autonomous loops with quality gates, use ralph-cli (separate tool):
    https://github.com/srdjan/ralph-cli

Examples:
  macbox --prompt "fix the build"
  macbox --prompt "refactor auth" --preset fullstack-typescript
  macbox presets list
  macbox presets show fullstack-typescript
  macbox profiles list
  macbox sessions list --repo .
  macbox clean --worktree ai-claude-1
  macbox workspace new --name feature-auth
  macbox workspace list
`;
  console.log(s.trim());
};
