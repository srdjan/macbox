# macbox (native macOS sandbox runner for AI agents)

A CLI that:
1. Creates a **git worktree** for an agent session
2. Creates an isolated sandbox **HOME/cache/tmp** inside that worktree
3. Launches your agent **inside a macOS Seatbelt sandbox** via `sandbox-exec`
4. (Optional) Collects **Seatbelt denial logs** into a per-worktree file (`--trace`)

This is **macOS-native** (not Linux containers). It's meant to feel like "packnplay", but without Docker or cloud dependencies.

> Note: `sandbox-exec` is deprecated by Apple, but still present on macOS today and used by tools in the wild.
> If Apple removes it in the future, the same policy can be applied by a signed helper using the underlying sandbox APIs.

## Requirements

- macOS
- `git`
- `/usr/bin/sandbox-exec` (present on current macOS releases)

## Installation

Download the latest release from GitHub:

```bash
curl -fsSL https://github.com/srdjans/macbox/releases/latest/download/install.sh | bash
```

Or install manually:

```bash
# Download binary and profiles
curl -fsSL -o /tmp/macbox https://github.com/srdjans/macbox/releases/latest/download/macbox
curl -fsSL -o /tmp/profiles.tar.gz https://github.com/srdjans/macbox/releases/latest/download/profiles.tar.gz

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
