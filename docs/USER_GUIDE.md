# macbox user guide

macbox runs AI coding agents in a native macOS Seatbelt sandbox using git
worktrees.

Core concepts:

1. Agent process (`claude`, `codex`, or custom executable)
2. Git worktree isolation per session
3. Composed sandbox profile (base policy + optional profiles)
4. Persisted sessions and optional workspace records

## Requirements

- macOS
- `git`
- `/usr/bin/sandbox-exec`

## Install

```bash
curl -fsSL https://github.com/srdjan/macbox/releases/latest/download/install.sh | bash
```

Verify:

```bash
macbox --help
```

## Quickstart

```bash
# Run prompt mode (required)
macbox --prompt "fix the build"

# Use a preset
macbox --preset fullstack-typescript --prompt "refactor auth"

# Pass extra args to agent after --
macbox --prompt "fix tests" -- --verbose
```

Agent resolution order:

1. `--preset <name>`
2. `macbox.json` defaults
3. auto-detect installed agent

## Primary command

```bash
macbox --prompt <text> [options] [-- <agent args>]
```

Important options:

- `--preset <name>`
- `--profile <name[,name2...]>`
- `--worktree <name>`
- `--branch <ref>`
- `--cmd <path>`
- `--session <latest|worktreeName|repoId/worktreeName>`
- `--new-worktree`
- `--allow-network` / `--block-network` / `--no-network`
- `--allow-exec` / `--block-exec`
- `--allow-fs-read <p1[,p2...]>`
- `--allow-fs-rw <p1[,p2...]>`
- `--no-host-claude-profile`
- `--debug`
- `--trace`
- `--json` (management commands)
- `--repo <path>`
- `--base <path>`

Use `macbox --help-all` for full command help.

If neither `--worktree` nor `--session` is provided, macbox may reuse the latest
session worktree for the resolved agent. Use `--new-worktree` to force a fresh
worktree.

## Worktree naming safety

`--worktree` names may only include letters, numbers, `.`, `_`, and `-`. Path
separators are intentionally rejected.

## What is sandboxed

Inside the sandbox, macbox sets:

- `HOME=<worktree>/.macbox/home`
- `XDG_CONFIG_HOME=<worktree>/.macbox/home/.config`
- `XDG_CACHE_HOME=<worktree>/.macbox/cache`
- `TMPDIR=<worktree>/.macbox/tmp`
- `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
- tool caches under `<worktree>/.macbox/cache/*`

Default policy:

- Network: allowed
- Subprocess execution: allowed
- Writes: restricted to worktree, required git dirs, minimal temp/device roots

## Profiles

Profiles are JSON snippets that extend sandbox access.

Lookups (first match wins):

1. `$MACBOX_PROFILES_DIR/<name>.json` (if set)
2. `~/.config/macbox/profiles/<name>.json`
3. bundled profiles (`<prefix>/share/macbox/profiles`)

Commands:

```bash
macbox profiles list
macbox profiles show host-tools
```

Built-ins include:

- `agent-claude`
- `agent-codex`
- `host-tools`
- `host-ssh`
- `host-claude`

Note: for Claude, macbox auto-enables `host-claude` by default to allow access
to `~/.claude` session/auth state. Use `--no-host-claude-profile` to opt out.

## Presets

Presets bundle agent + profiles + capabilities + env variables.

Lookups (first match wins):

1. `$MACBOX_PRESETS_DIR/<name>.json` (if set)
2. `~/.config/macbox/presets/<name>.json`
3. bundled presets (`<prefix>/share/macbox/presets`)

Commands:

```bash
macbox presets list
macbox presets show fullstack-typescript
```

Schema fields:

- `name`
- `description`
- `agent` (`claude`, `codex`, `custom`)
- `profiles`
- `capabilities.network`
- `capabilities.exec`
- `capabilities.extraReadPaths`
- `capabilities.extraWritePaths`
- `env`
- `worktreePrefix`
- `startPoint`

## Sessions

Each run persists a session record under:

`<base>/sessions/<repoId>/<worktree>.json`

Commands:

```bash
macbox sessions list
macbox sessions list --json
macbox sessions show latest
macbox sessions show <repoId/worktreeName>
macbox sessions delete <id>
macbox sessions clean --repo .
macbox sessions clean --all
```

Reuse defaults:

```bash
macbox --session latest --prompt "continue"
```

## Workspaces

Workspaces are lightweight named records that point to a worktree + session.

Commands:

```bash
macbox workspace new --name feature-auth
macbox workspace list
macbox workspace show <id>
macbox workspace open <id>
```

`workspace open` prints the session id and a ready-to-run continuation command.

## Cleanup

```bash
macbox clean --worktree <name>
macbox clean --all
```

## Trace sandbox denials

`--trace` queries unified logs after execution and writes:

`<worktree>/.macbox/logs/sandbox-violations.log`

## Project defaults (`macbox.json`)

Create at repo root:

```json
{
  "schema": "macbox.config.v1",
  "defaults": {
    "agent": "claude",
    "preset": "fullstack-typescript",
    "profiles": ["host-tools"]
  }
}
```

## v2 Simplification note

Since v2.0.0, macbox focuses on sandboxed agent execution only. Ralph, Flows,
Skills, Context Packs, and Projects registry were removed. For autonomous loops,
use `ralph-cli` separately.

## Development

```bash
deno task dev -- --help
deno task lint
deno task test
```
