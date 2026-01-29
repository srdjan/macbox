export const printHelp = () => {
  const s = `
macbox — run AI agents in a native macOS sandbox (Seatbelt) using git worktrees

Usage:
  macbox start [--agent claude|codex] [--preset <name>] [--profile <name[,name2...]>] [--prompt <text>]
               [--allow-network|--block-network] [--allow-exec|--block-exec]
               [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]
               [--repo <path>] [--base <path>] -- <agent args...>

  # Aliases
  macbox claude
  macbox codex

  macbox run   [--agent claude|codex] [--cmd <path>] [--worktree <name>] [--branch <branch>]
               [--preset <name>] [--profile <name[,name2...]>] [--prompt <text>]
               [--allow-network|--block-network] [--allow-exec|--block-exec]
               [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]
               [--session <latest|worktreeName|repoId/worktreeName>] [--repo <path>] [--base <path>] -- <agent args...>

  macbox shell [--agent claude|codex] [--worktree <name>] [--preset <name>]
               [--profile <name[,name2...]>] [--allow-network|--block-network] [--allow-exec|--block-exec]
               [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]
               [--session <latest|worktreeName|repoId/worktreeName>] [--repo <path>] [--base <path>] -- <shell args...>

  macbox attach <repoId/worktreeName | latest>
               [--profile <name[,name2...]>] [--allow-network|--block-network] [--allow-exec|--block-exec]
               [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]
               [--base <path>] -- <shell args...>

  macbox skills list [--json] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills describe <name> [--json] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills registry [--json] [--write] [--committed] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills contract [--json]
  macbox skills path <name> [--file <skill.json|run.ts|README.md|dir>] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills edit <name> [--file <...>] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills init <name> [--local] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]
  macbox skills run  <name> [--json] [--capture] [--result <path>] [--worktree <name>] [--session <ref>] [--agent claude|codex]
               [--profile <name[,name2...]>] [--allow-network|--block-network] [--allow-exec|--block-exec]
               [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]
               [--repo <path>] [--base <path>] -- <skill args...>

  macbox sessions list [--repo <path>] [--base <path>] [--agent claude|codex]
  macbox sessions show <id|worktreeName|latest> [--repo <path>] [--base <path>] [--agent claude|codex]
  macbox sessions delete <id|worktreeName> [--repo <path>] [--base <path>] [--agent claude|codex]
  macbox sessions clean [--all] [--repo <path>] [--base <path>]

  macbox clean [--worktree <name> | --all] [--repo <path>] [--base <path>]

  macbox profiles list
  macbox profiles show <name>

  macbox presets list
  macbox presets show <name>
  macbox presets create <name> [--template <preset>]
  macbox presets edit <name>
  macbox presets delete <name>

  macbox project add [--name <alias>] [--repo <path>] [--agent claude|codex] [--preset <name>]
  macbox project list
  macbox project show <name>
  macbox project remove <name>

  macbox workspace new [--issue N] [--name <label>] [--preset <name>] [--agent claude|codex]
                       [--branch <start-point>] [--worktree <name>] [--repo <path>] [--base <path>]
  macbox workspace list [--all] [--archived] [--repo <path>] [--base <path>]
  macbox workspace show <id> [--base <path>]
  macbox workspace open <id> [--base <path>]
  macbox workspace archive <id> [--base <path>]
  macbox workspace restore <id> [--base <path>]

  macbox ralph <prompt-or-prd-path>
               [--agent claude|codex] [--cmd <path>] [--preset <name>] [--max-iterations <N>]
               [--gate "name:cmd"] [--no-commit] [--profile <name[,name2...]>]
               [--worktree <name>] [--branch <start-point>] [--debug] [--trace] [--json]
               [--repo <path>] [--base <path>]

  macbox flow run <name> [--workspace <id>] [--worktree <name>] [--json] [--debug] [--repo <path>] [--base <path>]
  macbox flow list [--worktree <name>] [--repo <path>] [--base <path>]
  macbox flow show <name> [--worktree <name>] [--repo <path>] [--base <path>]

  macbox context pack [--workspace <id>] [--worktree <name>] [--summary <text>] [--repo <path>] [--base <path>]
  macbox context show <packId> [--workspace <id>] [--worktree <name>] [--repo <path>] [--base <path>]
  macbox context list [--workspace <id>] [--worktree <name>] [--repo <path>] [--base <path>]

  macbox authenticate --agent claude|codex [--cmd <path>] -- <agent auth args...>

Notes:
  • Sessions are persisted under: <base>/sessions/<repoId>/<worktree>.json
    Use 'macbox attach <id>' to re-open a saved sandbox with the same defaults.
  • Passing --agent automatically composes a bundled profile (agent-claude or agent-codex).
    For 'shell', if --worktree is omitted, macbox uses ai-<agent> (e.g., ai-claude).
    You can still add more with --profile, and everything is additive.
  • For Codex, macbox sets CODEX_HOME inside the sandbox HOME to keep ~/.codex off the host.

  • Presets bundle agent, profiles, capabilities, and environment into reusable configurations.
    Use --preset <name> with run/shell to apply a preset. CLI flags override preset defaults.
    Built-in presets: fullstack-typescript, python-ml, rust-dev
    User presets live under: ~/.config/macbox/presets/*.json

  - Uses /usr/bin/sandbox-exec to apply a Seatbelt sandbox profile.
  - --trace writes sandbox denial logs to: <worktree>/.macbox/logs/sandbox-violations.log
  - --profile composes additional read/write allowlists into the sandbox profile.
    Built-ins live under: <repo>/profiles/*.json
    User profiles live under: ~/.config/macbox/profiles/*.json
  - Creates worktrees under: <base>/worktrees/<repoId>/<worktree>
  - Agent HOME/caches/tmp live under: <worktree>/.macbox/

  - Projects register repos for multi-repo awareness.
    Registry lives at: ~/.config/macbox/projects.json
  - Workspaces wrap a (project, worktree, session) into a managed lifecycle.
    Use 'macbox workspace new' to create, 'macbox workspace archive' to freeze.
    Workspaces live under: <base>/workspaces/<projectId>/<workspaceId>.json
    Alias: 'macbox ws' is shorthand for 'macbox workspace'.
  - Flows are named step sequences defined in macbox.json at the repo root.
    Steps can be built-in (steps:shell, steps:git.*), skill-backed (skills:<name>),
    or agent-backed (steps:agent.run). Flow results are saved to .macbox/flows/.
  - Ralph is an autonomous loop that iterates over a PRD (prd.json) or free-form prompt.
    Each iteration spawns a sandboxed agent, runs quality gates, and commits passing work.
    State is saved to .macbox/ralph/. Use steps:ralph.run in flows for the same behavior.
Examples:
  macbox start
  macbox claude
  macbox start --preset fullstack-typescript
  deno run -A src/main.ts run --agent claude -- --help
  deno run -A src/main.ts run --agent claude --trace -- --help
  deno run -A src/main.ts run --agent claude --profile host-tools -- --help
  deno run -A src/main.ts run --preset fullstack-typescript -- --help
  deno run -A src/main.ts shell --preset python-ml
  deno run -A src/main.ts presets list
  deno run -A src/main.ts presets show fullstack-typescript
  deno run -A src/main.ts presets create my-preset --template fullstack-typescript
  deno run -A src/main.ts profiles list
  deno run -A src/main.ts profiles show host-tools
  deno run -A src/main.ts run --agent codex --worktree ai-codex -- --help
  deno run -A src/main.ts shell --worktree ai -- /bin/zsh -l
  deno run -A src/main.ts shell --worktree ai --trace -- /bin/zsh -l
  deno run -A src/main.ts skills list --worktree ai
  deno run -A src/main.ts skills init fmt --worktree ai
  deno run -A src/main.ts skills run fmt --worktree ai -- --help
  deno run -A src/main.ts clean --worktree ai
  deno run -A src/main.ts project add
  deno run -A src/main.ts project list
  deno run -A src/main.ts workspace new --agent claude --issue 42
  deno run -A src/main.ts workspace list
  deno run -A src/main.ts ws list --archived

`;
  console.log(s.trim());
};
