# macbox - native macOS sandbox workbench for AI agents

A CLI that turns your Mac into a local dev workbench for AI coding agents:

1. Creates **git worktrees** for isolated agent sessions
2. Runs agents **inside a macOS Seatbelt sandbox** via `sandbox-exec`
3. Manages **workspaces** with lifecycle (create, archive, restore, evict)
4. Runs **composable flows** - named step sequences defined in `macbox.json`
5. Captures **context packs** - reproducible snapshots of repo state for agent handoff
6. Executes **swarm runs** - the same flow across multiple workspaces in parallel

100% macOS-native. No Docker, no cloud, CLI-first.

> Note: `sandbox-exec` is deprecated by Apple, but still present on macOS today and used by tools in the wild.
> If Apple removes it in the future, the same policy can be applied by a signed helper using the underlying sandbox APIs.

## Requirements

- macOS
- `git`
- `/usr/bin/sandbox-exec` (present on current macOS releases)

## Installation

Download the latest release from GitHub:

```bash
curl -fsSL https://github.com/srdjan/macbox/releases/latest/download/install.sh | bash
```

Or install manually:

```bash
# Download binary and profiles
curl -fsSL -o /tmp/macbox https://github.com/srdjan/macbox/releases/latest/download/macbox
curl -fsSL -o /tmp/profiles.tar.gz https://github.com/srdjan/macbox/releases/latest/download/profiles.tar.gz

# Install to /usr/local (requires sudo)
sudo install -m 755 /tmp/macbox /usr/local/bin/macbox
sudo mkdir -p /usr/local/share/macbox
sudo tar -xzf /tmp/profiles.tar.gz -C /usr/local/share/macbox

# Or install to ~/.local (no sudo)
install -m 755 /tmp/macbox ~/.local/bin/macbox
mkdir -p ~/.local/share/macbox
tar -xzf /tmp/profiles.tar.gz -C ~/.local/share/macbox
```

You can override profile search with `MACBOX_PROFILES_DIR=/path/to/profiles`.

---

## Usage

### Run an agent in a sandbox

```bash
# Use default worktree name "ai" (reused if already created)
macbox run --agent claude -- --help

# Create a named worktree
macbox run --agent codex --worktree ai-codex -- --help

# Override the executable (if your agent is not on PATH as `claude` / `codex`)
macbox run --cmd /opt/homebrew/bin/claude --worktree ai1 -- --help

# Compose additional profiles into the sandbox
macbox run --agent claude --profile host-tools -- --help
macbox run --agent claude --profile host-tools,host-ssh -- --help

# Collect sandbox denial logs
macbox run --agent claude --trace -- --help
```

### Interactive shell in the sandbox

```bash
# Warm shell: auto-applies agent profile and defaults worktree to ai-<agent>
macbox shell --agent claude

# Explicit worktree name + explicit shell
macbox shell --worktree ai -- /bin/zsh -l

# With a profile
macbox shell --worktree ai --profile host-tools -- /bin/zsh -l
```

### Clean up worktrees

```bash
macbox clean --worktree ai
macbox clean --all
```

---

## What's sandboxed?

Inside the sandbox:
- `HOME` is set to `<worktree>/.macbox/home`
- Caches are set to `<worktree>/.macbox/cache`
- `TMPDIR` is set to `<worktree>/.macbox/tmp`
- Read/exec of system paths is allowed (including Homebrew)
- **Read/write** is limited to:
  - The worktree path
  - The repo's git dirs needed for worktree operation (`git-common-dir` + `git-dir`)
  - `/dev` and a minimal temp area

Network is allowed by default. Disable it with `--block-network` (alias: `--no-network`).

---

## Capability flags

macbox defaults to a "friendly" sandbox: **network + subprocess execution are allowed**, while **file writes are restricted** to the worktree and a few safe temp roots.

Override capabilities per run:

- `--allow-network` / `--block-network` (alias: `--no-network`)
- `--allow-exec` / `--block-exec`
- `--allow-fs-read <p1[,p2...]>` - additional read-only paths
- `--allow-fs-rw <p1[,p2...]>` - additional writable paths (triggers a warning if outside worktree/git dirs)

Examples:

```bash
# Disable network
macbox run --agent claude --block-network -- --help

# Add read-only host toolchain paths
macbox run --agent codex --allow-fs-read=/usr/local,/opt/homebrew -- --help

# Add a writable scratch path (discouraged)
macbox run --agent claude --allow-fs-rw=/tmp/my-scratch -- --help
```

---

## Profiles

Some toolchains are installed in user-owned locations (e.g. `~/.local/bin`, `~/.nvm`, `~/.asdf`).
By default, macbox **does not** grant sandbox access to your host home directory.

When you *choose* to relax that, compose profile snippets via `--profile name[,name2...]`.

Profile search order:
1. `$MACBOX_PROFILES_DIR/<name>.json` (if set)
2. `~/.config/macbox/profiles/<name>.json`
3. Bundled profiles next to the binary (or `<prefix>/share/macbox/profiles`)

You can also pass a direct file path (e.g. `--profile ./myprofile.json`).

List and inspect profiles:

```bash
macbox profiles list
macbox profiles show host-tools
macbox profiles show agent-claude
```

> Profiles can grant *write* access outside the worktree. macbox warns on stderr when a profile adds writes outside the worktree/git dirs.

### Bundled agent profiles

macbox ships bundled profiles that are auto-applied when you pass `--agent`:

- `agent-claude`: enables Mach service lookups (so Keychain/system IPC works).
- `agent-codex`: enables Mach service lookups and sets `CODEX_HOME=$HOME/.codex` inside the sandbox.

---

## Presets

Presets bundle agent configuration, profiles, capabilities, and environment variables into reusable templates. Use them to define complete development workflow configurations.

### List and inspect presets

```bash
macbox presets list
macbox presets show fullstack-typescript
```

### Run with a preset

```bash
# Run with a preset - applies agent, profiles, capabilities, and env vars
macbox run --preset fullstack-typescript -- --help

# Shell with a preset
macbox shell --preset python-ml

# CLI flags override preset defaults
macbox run --preset fullstack-typescript --block-network -- --help
```

### Bundled presets

macbox ships with these presets:

- `fullstack-typescript`: Node.js and Deno toolchains, `host-tools` profile, `NODE_ENV=development`
- `python-ml`: Python with pip, pyenv, virtualenvs, `host-tools` profile
- `rust-dev`: Cargo and rustup toolchains, `host-tools` profile, `RUST_BACKTRACE=1`

### Create your own preset

```bash
# Create from template
macbox presets create my-preset --template fullstack-typescript

# Or create a blank preset
macbox presets create my-preset

# Edit the preset
macbox presets edit my-preset

# Delete a user preset
macbox presets delete my-preset
```

Presets are stored in `~/.config/macbox/presets/<name>.json`.

### Preset schema

```json
{
  "name": "my-preset",
  "description": "My custom development preset",
  "agent": "claude",
  "model": "claude-sonnet-4-20250514",
  "profiles": ["host-tools", "host-ssh"],
  "capabilities": {
    "network": true,
    "exec": true,
    "extraReadPaths": ["/opt/homebrew", "~/.nvm"],
    "extraWritePaths": []
  },
  "env": {
    "NODE_ENV": "development"
  },
  "worktreePrefix": "ai-mypreset",
  "startPoint": "main"
}
```

Preset fields:

- `agent`: `claude`, `codex`, or `custom`
- `model`: Model identifier (written to agent config in sandbox home)
- `profiles`: Array of profile names to compose
- `capabilities`: Network, exec, and filesystem permissions
- `env`: Environment variables to inject into the sandbox
- `worktreePrefix`: Default worktree name prefix (e.g., `ai-mypreset` becomes `ai-mypreset-ai`)
- `startPoint`: Default git ref for new worktrees

---

## Sessions

macbox persists a **session record per repo/worktree** so you can quickly re-open a sandbox with the same defaults.

Sessions are stored under `<base>/sessions/<repoId>/<worktree>.json` (default base: `~/.local/share/macbox`).

You can pass `--session` to `run`/`shell` to reuse a saved worktree and defaults.

### List sessions

```bash
macbox sessions list
macbox sessions list --repo .          # current repo only
macbox sessions list --repo . --agent claude
```

### Show a session

```bash
macbox sessions show latest            # latest session (global)
macbox sessions show latest --repo .   # latest for this repo
macbox sessions show <repoId/worktreeName>
```

### Attach (re-open) a session

```bash
macbox attach latest
macbox attach <repoId/worktreeName>
macbox attach <repoId/worktreeName> -- /bin/zsh -l
macbox attach <repoId/worktreeName> --trace
```

### Clean/delete sessions

```bash
macbox sessions clean --repo .         # delete sessions for current repo
macbox sessions clean --all            # delete all sessions
macbox sessions delete <id>            # delete a specific session
```

---

## Skills

Skills are **small, repo-local commands** you can run **inside the same Seatbelt sandbox** as your agent.

Think of them as "named macros" that live inside the sandbox worktree:

- **Committed skills**: `<worktree>/skills/<skill>/skill.json`
- **Local-only skills** (gitignored): `<worktree>/.macbox/skills/<skill>/skill.json`

### List skills

```bash
macbox skills list --worktree ai
```

### Init a skill

```bash
# committed (goes under <worktree>/skills/...)
macbox skills init fmt --worktree ai

# local-only (goes under <worktree>/.macbox/skills/...)
macbox skills init scratch --local --worktree ai
```

The template creates `skill.json`, `run.ts`, and `README.md`.

### Run a skill

```bash
macbox skills run fmt --worktree ai
macbox skills run fmt --worktree ai -- --help
macbox skills run fmt --agent codex --worktree ai-codex -- --help
macbox skills run fmt --worktree ai --trace
```

### `skill.json` schema

```json
{
  "name": "fmt",
  "description": "Format the repo (runs inside the sandbox)",
  "command": ["deno", "fmt"],
  "cwd": "${WORKTREE}",
  "env": {
    "EXAMPLE": "hello-from-${SKILL_DIR}"
  }
}
```

Notes:
- `command` is an argv list. Args after `--` are appended.
- `cwd` defaults to the skill directory. Relative paths are resolved against the skill directory.
- `env` values support `${WORKTREE}` and `${SKILL_DIR}` expansion.

### Inspect and edit skills

```bash
macbox skills describe fmt --worktree ai
macbox skills describe fmt --worktree ai --json

macbox skills path fmt --worktree ai
macbox skills path fmt --file run.ts --worktree ai

# opens in $VISUAL or $EDITOR, falling back to `open -t`
macbox skills edit fmt --worktree ai
```

### Skills registry

Generate a JSON registry of all skills in a worktree:

```bash
# writes: <worktree>/.macbox/skills/registry.json (gitignored)
macbox skills registry --worktree ai --write

# write a committed registry
macbox skills registry --worktree ai --write --committed

# print to stdout
macbox skills registry --worktree ai --json
```

### Skill runner contract (v1)

macbox injects these env vars for every `skills run`:

- `MACBOX_WORKTREE` - absolute path to the sandbox worktree
- `MACBOX_SKILL` - skill name
- `MACBOX_SKILL_DIR` - absolute path to the skill directory
- `MACBOX_SESSION` - short session id for this invocation
- `MACBOX_SKILL_ARGS_JSON` - JSON array of args passed after `--`

Structured output (optional):
- `MACBOX_RESULT_PATH` - absolute file path where the skill may write JSON
- `MACBOX_RESULT_FORMAT` - currently `json`

For machine-readable output:

```bash
macbox skills run fmt --worktree ai --json -- --help
```

This prints a JSON envelope (`macbox.skills.run.v1`) containing `ok`, `exitCode`, `session`, `skill`, captured `stdout`/`stderr`, and parsed `result` if the skill wrote JSON to `$MACBOX_RESULT_PATH`.

Print the contract itself:

```bash
macbox skills contract
macbox skills contract --json
```

---

## Projects

Projects register repos so macbox can track workspaces across multiple repositories. A project is identified by a hash of its repo path, matching the existing `repoId` used by sessions.

```bash
# Register the current repo (auto-derives name from directory)
macbox project add

# Register with a custom name
macbox project add --name my-app --repo /path/to/repo

# Set project-level defaults
macbox project add --agent claude --preset fullstack-typescript

# List and inspect
macbox project list
macbox project show my-app

# Remove a project from the registry
macbox project remove my-app
```

Project registry is stored at `~/.config/macbox/projects.json`.

---

## Workspaces

Workspaces wrap a (project, worktree, session) triple into a managed lifecycle. Each workspace has a status (`active` or `archived`), optional issue/branch linkage, and tracks flow runs and context packs.

Existing `macbox run/shell/attach` commands continue to work unchanged. Workspaces are an incremental adoption layer.

### Create a workspace

```bash
# Create a workspace with an agent
macbox workspace new --agent claude

# Link to a GitHub issue (worktree auto-named ws-issue-42)
macbox workspace new --agent claude --issue 42

# With a preset and custom name
macbox workspace new --preset fullstack-typescript --name feature-auth
```

Workspace creation orchestrates: detect repo, find/create project, create worktree, create sandbox dirs, save session, and create workspace record.

### List and inspect

```bash
macbox workspace list                 # active workspaces for current repo
macbox workspace list --archived      # archived workspaces
macbox workspace list --all           # both active and archived
macbox workspace show <id>
```

The alias `macbox ws` is shorthand for `macbox workspace`.

### Open a workspace

```bash
macbox workspace open <id>            # attach to the workspace's session
```

### Archive and restore

```bash
# Archive (freeze) a workspace
macbox workspace archive <id>

# Archive and evict the worktree from disk (keeps git branch + metadata)
macbox workspace archive <id> --evict

# Restore an archived workspace (re-creates worktree if evicted)
macbox workspace restore <id>
```

Archiving with `--evict` creates a context pack capturing the current state, then removes the worktree directory. Restoring re-creates the worktree from the branch pointer and runs the `onWorkspaceRestore` hook if defined in `macbox.json`.

Workspaces are stored under `<base>/workspaces/<projectId>/<workspaceId>.json`.

---

## Flows

Flows are named step sequences defined in a `macbox.json` file at the repo root. Think of a flow as a local CI pipeline that runs inside the sandbox.

### `macbox.json` schema

```json
{
  "schema": "macbox.config.v1",
  "defaults": {
    "agent": "claude",
    "profiles": ["host-tools"]
  },
  "flows": {
    "build": {
      "description": "Build and test the project",
      "steps": [
        { "id": "install", "type": "steps:shell", "args": { "cmd": "npm install" } },
        { "id": "build", "type": "steps:shell", "args": { "cmd": "npm run build" } },
        { "id": "test", "type": "steps:shell", "args": { "cmd": "npm test" }, "continueOnError": true }
      ]
    },
    "merge-main": {
      "description": "Fetch and merge main branch",
      "steps": [
        { "id": "fetch", "type": "steps:git.fetch" },
        { "id": "merge", "type": "steps:git.merge", "args": { "branch": "origin/main" } },
        { "id": "conflicts", "type": "steps:git.conflictList" }
      ]
    }
  },
  "hooks": {
    "onWorkspaceCreate": [
      { "id": "deps", "type": "steps:shell", "args": { "cmd": "npm install" } }
    ],
    "onWorkspaceRestore": [
      { "id": "deps", "type": "steps:shell", "args": { "cmd": "npm install" } }
    ]
  }
}
```

### Built-in step types

| Type | Purpose | Required args |
|------|---------|---------------|
| `steps:shell` | Run a shell command | `cmd` (string) |
| `steps:git.diff` | Show working tree diff | - |
| `steps:git.status` | Porcelain status | - |
| `steps:git.checkout` | Checkout a branch | `branch` (string) |
| `steps:git.pull` | Pull from remote | - |
| `steps:git.commit` | Commit changes | `message` (string), optional `all` (boolean) |
| `steps:git.fetch` | Fetch from remote | - |
| `steps:git.merge` | Merge a branch | `branch` (string) |
| `steps:git.conflictList` | List conflicted files | - |
| `steps:git.add` | Stage files | optional `files` (string array) |
| `steps:agent.run` | Launch the configured agent | optional `passthrough` (string array) |
| `steps:gh.issueGet` | Get GitHub issue details | `number` (integer) |
| `steps:gh.prGet` | Get GitHub PR details | `number` (integer) |
| `steps:gh.prCreate` | Create a GitHub PR | `title` (string), optional `body`, `base`, `head` |
| `steps:gh.prMerge` | Merge a GitHub PR | `number` (integer), optional `method` |
| `skills:<name>` | Run a named skill | optional `skillArgs` (string array) |

The `steps:gh.*` types require the `gh` CLI to be installed and authenticated.

### Running flows

```bash
# Run a named flow
macbox flow run build

# Run in a specific workspace
macbox flow run build --workspace ws-abc123

# List available flows
macbox flow list

# Show flow definition
macbox flow show build
```

Flow results are persisted to `<worktree>/.macbox/flows/<flowName>-<timestamp>.json`.

Steps execute sequentially. A non-zero exit code halts the flow unless `continueOnError: true` is set on that step.

### Hooks

Hooks are step arrays that run automatically at lifecycle points:

- `onWorkspaceCreate` - runs after `macbox workspace new`
- `onWorkspaceRestore` - runs after `macbox workspace restore`
- `onFlowComplete` - runs after any flow completes

---

## Context packs

Context packs are reproducible snapshots of the repo state at a point in time. They capture branch, commit SHA, dirty status, modified files, the current diff, and recent git log. Use them to hand off state between agents or to bookmark a workspace before archiving.

```bash
# Create a context pack for the current worktree
macbox context pack

# Create for a specific workspace
macbox context pack --workspace ws-abc123

# Add a custom summary
macbox context pack --summary "Pre-merge state for issue #42"

# List packs
macbox context list

# Inspect a pack
macbox context show <packId>
```

Packs are stored under `<worktree>/.macbox/context/packs/<packId>/` and contain:

| File | Contents |
|------|----------|
| `pack.json` | Pack metadata (id, timestamp, repo state) |
| `repo_state.json` | Branch, SHA, dirty flag, modified files |
| `diff.patch` | Output of `git diff` |
| `summary.md` | Human-readable summary |
| `notes.md` | User notes (initially empty) |
| `commands.log` | Recent git log |

---

## Swarm

Swarm runs a flow across multiple workspaces in parallel with configurable concurrency. Use it for batch operations like running the same build/test flow across several feature branches simultaneously.

```bash
# Run a flow across existing workspaces
macbox swarm run --flow build --workspaces ws-abc123,ws-def456,ws-ghi789

# Limit concurrency (default: 3)
macbox swarm run --flow test --workspaces ws-abc123,ws-def456 --max-parallel 2

# Get JSON output
macbox swarm run --flow build --workspaces ws-abc123,ws-def456 --json

# Create N workspaces and optionally run a flow on each
macbox swarm new --count 3 --agent claude --issue 42 --flow build
```

`macbox swarm new` creates the specified number of workspaces (each with its own worktree) and optionally runs a flow on all of them in parallel.

---

## Tracing sandbox denials (`--trace`)

Seatbelt violations do not reliably appear on stderr/stdout - they're recorded in the macOS unified log.
When `--trace` is enabled, macbox:

1. Enables `(debug deny)` in the generated SBPL profile
2. After the command exits, queries the unified log for sandbox denial events
3. Writes the output to `<worktree>/.macbox/logs/sandbox-violations.log`

---

## Safety boundary note (git worktrees)

Git worktrees store metadata outside the worktree (under the main repo's `.git/`).
To keep `git status/commit` working inside the sandbox, macbox allows access to:
- `git rev-parse --git-common-dir`
- `git rev-parse --git-dir`

These are limited to **this repo only** (not your whole home directory).

---

## Development

Requires [Deno](https://deno.land/).

### Run from source

```bash
deno task dev -- --help
```

Or run directly:

```bash
deno run -A src/main.ts --help
```

### Example commands (dev mode)

```bash
# Run an agent
deno run -A src/main.ts run --agent claude -- --help

# Interactive shell
deno run -A src/main.ts shell --agent claude

# List sessions
deno run -A src/main.ts sessions list --repo .

# Skills
deno run -A src/main.ts skills list --worktree ai
deno run -A src/main.ts skills run fmt --worktree ai

# Projects and workspaces
deno run -A src/main.ts project add
deno run -A src/main.ts workspace new --agent claude --issue 42
deno run -A src/main.ts ws list

# Flows (requires macbox.json in repo root)
deno run -A src/main.ts flow list
deno run -A src/main.ts flow run build

# Context packs
deno run -A src/main.ts context pack
deno run -A src/main.ts context list

# Swarm (parallel execution)
deno run -A src/main.ts swarm new --count 3 --agent claude --flow build
```

### Build from source

Compile a standalone macOS binary:

```bash
deno task compile:mac
```

Install using the install script:

```bash
sudo ./scripts/install.sh
# or without sudo:
PREFIX="$HOME/.local" ./scripts/install.sh
```
