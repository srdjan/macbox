# macbox - native macOS sandbox for AI agents

A CLI that runs AI coding agents in a macOS sandbox using git worktrees for
isolation.

1. Creates **git worktrees** for isolated agent sessions
2. Runs agents **inside a macOS Seatbelt sandbox** via `sandbox-exec`
3. Manages **sandbox profiles** for composable capability control
4. Persists **sessions** for resuming previous configurations

100% macOS-native. No Docker, no cloud, CLI-first.

> Note: `sandbox-exec` is deprecated by Apple, but still present on macOS today
> and used by tools in the wild. If Apple removes it in the future, the same
> policy can be applied by a signed helper using the underlying sandbox APIs.

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

The `--prompt` flag is required. Agent is resolved from: preset > macbox.json
defaults > auto-detect.

```bash
# Direct prompt - runs in pipe mode and exits when done
macbox --prompt "fix the build"
macbox --prompt "refactor the auth module"

# With a preset for a complete workflow configuration
macbox --preset fullstack-typescript --prompt "add dark mode support"

# Pass extra flags through to the agent after --
macbox --prompt "fix the build" -- --verbose
```

Authentication is automatic: macbox checks for credentials on first use and runs
the agent's setup flow if needed.

### Advanced flags

All advanced flags are accepted but hidden from primary help. Use
`macbox --help-all` to see the full reference.

```bash
# Named worktree
macbox --prompt "fix the build" --worktree my-feature

# Force a fresh worktree instead of reusing the latest session
macbox --prompt "fix the build" --new-worktree

# From a specific branch
macbox --prompt "fix the build" --branch feature/login

# Custom executable (if your agent isn't on PATH)
macbox --prompt "fix the build" --cmd /opt/homebrew/bin/claude

# Keep Claude isolated from host ~/.claude (requires ANTHROPIC_API_KEY)
macbox --prompt "fix the build" --no-host-claude-profile

# Compose additional profiles into the sandbox
macbox --prompt "fix the build" --profile host-tools
macbox --prompt "fix the build" --profile host-tools,host-ssh

# Collect sandbox denial logs
macbox --prompt "fix the build" --trace

# Machine-readable management output
macbox sessions list --json
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
- `XDG_CONFIG_HOME` is set to `<worktree>/.macbox/home/.config`
- `XDG_CACHE_HOME` is set to `<worktree>/.macbox/cache`
- `TMPDIR` is set to `<worktree>/.macbox/tmp`
- `PATH` is set to
  `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
- `DENO_DIR` is set to `<worktree>/.macbox/cache/deno`
- `NPM_CONFIG_CACHE` is set to `<worktree>/.macbox/cache/npm`
- `YARN_CACHE_FOLDER` is set to `<worktree>/.macbox/cache/yarn`
- `PNPM_HOME` is set to `<worktree>/.macbox/home/.local/share/pnpm`
- `GIT_CONFIG_GLOBAL` is set to `<worktree>/.macbox/home/.gitconfig`
- `GIT_CONFIG_SYSTEM` is set to `/dev/null`
- Read/exec of system paths is allowed (including Homebrew)
- **Read/write** is limited to:
  - The worktree path
  - The repo's git dirs needed for worktree operation (`git-common-dir` +
    `git-dir`)
  - `/dev` and a minimal temp area

Network is allowed by default. Disable it with `--block-network` (alias:
`--no-network`).

---

## Capability flags

macbox defaults to a "friendly" sandbox: **network + subprocess execution are
allowed**, while **file writes are restricted** to the worktree and a few safe
temp roots.

Override capabilities per run:

- `--allow-network` / `--block-network` (alias: `--no-network`)
- `--allow-exec` / `--block-exec`
- `--allow-fs-read <p1[,p2...]>` - additional read-only paths
- `--allow-fs-rw <p1[,p2...]>` - additional writable paths (triggers a warning
  if outside worktree/git dirs)

Examples:

```bash
# Disable network
macbox --prompt "fix the build" --block-network

# Add read-only host toolchain paths
macbox --prompt "fix the build" --allow-fs-read=/usr/local,/opt/homebrew

# Add a writable scratch path (discouraged)
macbox --prompt "fix the build" --allow-fs-rw=/tmp/my-scratch
```

---

## Profiles

Some toolchains are installed in user-owned locations (e.g. `~/.local/bin`,
`~/.nvm`, `~/.asdf`). By default, macbox avoids granting sandbox access to your
host home directory. For Claude, macbox auto-enables `host-claude` unless you
pass `--no-host-claude-profile`.

When you _choose_ to relax that, compose profile snippets via
`--profile name[,name2...]`.

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

> Profiles can grant _write_ access outside the worktree. macbox warns on stderr
> when a profile adds writes outside the worktree/git dirs.

### Bundled agent profiles

macbox ships bundled profiles that are auto-applied based on the resolved agent:

- `agent-claude`: enables Mach service lookups (so Keychain/system IPC works).
- `agent-codex`: enables Mach service lookups. `CODEX_HOME=$HOME/.codex` is set
  by macbox's environment setup (`env.ts`), not by the profile itself.
- `host-claude` (auto-enabled for Claude by default): grants read/write access
  to `~/.claude` for Claude CLI session/auth state. Disable with
  `--no-host-claude-profile`.

---

## Presets

Presets bundle agent configuration, profiles, capabilities, and environment
variables into reusable templates. Use them to define complete development
workflow configurations.

### List and inspect presets

```bash
macbox presets list
macbox presets show fullstack-typescript
```

### Run with a preset

```bash
# Run with a preset - applies agent, profiles, capabilities, and env vars
macbox --preset fullstack-typescript --prompt "add dark mode support"

# CLI flags override preset defaults
macbox --preset fullstack-typescript --prompt "fix the build" --block-network
```

### Bundled presets

macbox ships with one example preset:

- `fullstack-typescript`: Node.js and Deno toolchains, `host-tools` profile,
  `NODE_ENV=development`

### Create your own preset

Create or edit preset JSON files directly in `~/.config/macbox/presets/`:

```json
{
  "name": "my-preset",
  "description": "My custom development preset",
  "agent": "claude",
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

Preset search order:

1. `$MACBOX_PRESETS_DIR/<name>.json` (if set)
2. `~/.config/macbox/presets/<name>.json`
3. Bundled presets next to the binary (or `<prefix>/share/macbox/presets`)

### Preset schema

Preset fields:

- `name`: Preset identifier (string)
- `description`: Human-readable description (string, optional)
- `agent`: `claude`, `codex`, or `custom` (optional, defaults to auto-detect)
- `profiles`: Array of profile names to compose (optional)
- `capabilities`: Network, exec, and filesystem permissions (optional)
  - `network`: boolean (default: true)
  - `exec`: boolean (default: true)
  - `extraReadPaths`: array of additional read-only paths
  - `extraWritePaths`: array of additional writable paths
- `env`: Environment variables to inject into the sandbox (optional, object)
- `worktreePrefix`: Default worktree name prefix (optional, e.g. `ai-mypreset`
  becomes `ai-mypreset-1`)
- `startPoint`: Default git ref for new worktrees (optional, default: `HEAD`)

---

## Sessions

macbox persists a **session record per repo/worktree** so you can quickly
re-open a sandbox with the same defaults.

Sessions are stored under `<base>/sessions/<repoId>/<worktree>.json` (default
base: `~/.local/share/macbox`).

You can pass `--session` to reuse a saved worktree and defaults. If you do not
pass `--worktree` or `--session`, macbox may reuse the latest session worktree
for the resolved agent. Use `--new-worktree` to force a fresh worktree.

### List sessions

```bash
macbox sessions list
macbox sessions list --repo .          # current repo only
macbox sessions list --json            # machine-readable output
```

### Show a session

```bash
macbox sessions show latest            # latest session (global)
macbox sessions show latest --repo .   # latest for this repo
macbox sessions show <repoId/worktreeName>
```

### Clean/delete sessions

```bash
macbox sessions clean --repo .         # delete sessions for current repo
macbox sessions clean --all            # delete all sessions
macbox sessions delete <id>            # delete a specific session
```

---

## Workspaces

Workspaces provide named worktrees with associated session metadata. They are
lightweight records that map a human-readable name to a worktree and session.

### Create a workspace

```bash
# Create a workspace
macbox workspace new --name feature-auth

# With a preset
macbox workspace new --preset fullstack-typescript --name my-feature
```

### List and inspect

```bash
macbox workspace list                 # workspaces for current repo
macbox workspace show <id>
```

The alias `macbox ws` is shorthand for `macbox workspace`.

### Open a workspace

```bash
macbox workspace open <id>            # prints session info
```

Workspaces are stored under `<base>/workspaces/<repoId>/<workspaceId>.json`.

---

## Configuration: macbox.json

Configure project-level defaults by creating a `macbox.json` file at your repo
root:

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

The `defaults` section supports:

- `agent`: Default agent (`claude`, `codex`, or `custom`)
- `preset`: Default preset name
- `profiles`: Array of additional profile names to compose

---

## Tracing sandbox denials (`--trace` and `--debug`)

Seatbelt violations do not reliably appear on stderr/stdout - they're recorded
in the macOS unified log.

`--debug` enables `(debug deny)` in the generated SBPL profile so denials are
logged by the system. This is useful when you want to inspect logs yourself.

`--trace` includes everything `--debug` does, plus:

1. After the command exits, queries the unified log for sandbox denial events
2. Writes the output to `<worktree>/.macbox/logs/sandbox-violations.log`

---

## Safety boundary note (git worktrees)

Git worktrees store metadata outside the worktree (under the main repo's
`.git/`). To keep `git status/commit` working inside the sandbox, macbox allows
access to:

- `git rev-parse --git-common-dir`
- `git rev-parse --git-dir`

These are limited to **this repo only** (not your whole home directory).

---

## Autonomous Loops with Ralph

For autonomous iteration over PRDs with quality gates and multi-agent
collaboration, use [ralph-cli](https://github.com/srdjan/ralph-cli):

```bash
# Ralph orchestrates multiple macbox invocations
ralph prd.json --gate "typecheck:deno check src/main.ts" --gate "test:deno test -A"
```

Ralph is a separate tool that wraps macbox for complex autonomous workflows.

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
# Run an agent (--prompt is required)
deno run -A src/main.ts --prompt "fix the build"
deno run -A src/main.ts --preset fullstack-typescript --prompt "add dark mode"

# List sessions
deno run -A src/main.ts sessions list --repo .

# Workspaces
deno run -A src/main.ts workspace new --name my-feature
deno run -A src/main.ts ws list
```

### Build from source

Compile a standalone macOS binary:

```bash
deno task compile:mac              # default (current arch)
deno task compile:mac-arm          # Apple Silicon (aarch64)
deno task compile:mac-x64          # Intel (x86_64)
deno task compile:mac-universal    # Universal binary (both archs via lipo)
```

Install using the install script:

```bash
sudo ./scripts/install.sh
# or without sudo:
PREFIX="$HOME/.local" ./scripts/install.sh
```
