# macbox (native macOS sandbox runner for AI agents)

A tiny Deno CLI that:
1) creates a **git worktree** for an agent session
2) creates an isolated sandbox **HOME/cache/tmp** inside that worktree
3) launches your agent **inside a macOS Seatbelt sandbox** via `sandbox-exec`
4) (optional) collects **Seatbelt denial logs** into a per-worktree file (`--trace`)

This is **macOS-native** (not Linux containers). It’s meant to feel like “packnplay”, but without Docker/cloud.

> Note: `sandbox-exec` is deprecated by Apple, but still present on macOS today and used by tools in the wild.
> If Apple removes it in the future, the same policy can be applied by a signed helper using the underlying sandbox APIs.

## Requirements

- macOS
- `git`
- `/usr/bin/sandbox-exec` (present on current macOS releases)

## Install (dev)

```bash
deno task dev -- --help
```

Or run directly:

```bash
deno run -A src/main.ts --help
```

## Install (binary)

Build a standalone macOS binary:

```bash
deno task compile:mac
```

Install it and the bundled profiles (default prefix is `/usr/local`):

```bash
sudo ./scripts/install.sh
```

To install without sudo, choose a user prefix:

```bash
PREFIX="$HOME/.local" ./scripts/install.sh
```

You can override profile search with `MACBOX_PROFILES_DIR=/path/to/profiles`.

## Usage

### Run an agent in a new/reused worktree

```bash
# Use default worktree name "ai" (reused if already created)
deno run -A src/main.ts run --agent claude -- --help

# Create a new worktree name
deno run -A src/main.ts run --agent codex --worktree ai-codex -- --help

# Override the executable (if your agent is not on PATH as `claude` / `codex`)
deno run -A src/main.ts run --cmd /opt/homebrew/bin/claude --worktree ai1 -- --help

# Compose additional allowlists into the sandbox profile
# (bundled profiles live under ./profiles, user profiles under ~/.config/macbox/profiles)
deno run -A src/main.ts run --agent claude --profile host-tools -- --help
deno run -A src/main.ts run --agent claude --profile host-tools,host-ssh -- --help

# Collect sandbox denial logs into <worktree>/.macbox/logs/sandbox-violations.log
deno run -A src/main.ts run --agent claude --trace -- --help

# Same for codex
deno run -A src/main.ts run --agent codex --worktree ai-codex --trace -- --help
```

### Open an interactive shell in the sandbox (same policy)

```bash
# Warm shell: auto-applies agent profile and defaults worktree to ai-<agent>
deno run -A src/main.ts shell --agent claude

# Explicit worktree name + explicit shell
deno run -A src/main.ts shell --worktree ai -- /bin/zsh -l

# Same, but with a profile
deno run -A src/main.ts shell --worktree ai --profile host-tools -- /bin/zsh -l
```

### Clean up

```bash
deno run -A src/main.ts clean --worktree ai
deno run -A src/main.ts clean --all
```

## What’s sandboxed?

Inside the sandbox, we:
- set `HOME` to `<worktree>/.macbox/home`
- set caches to `<worktree>/.macbox/cache`
- set `TMPDIR` to `<worktree>/.macbox/tmp`
- allow read/exec of system paths (including Homebrew)
- allow **read/write** only to:
  - the worktree path
  - the repo’s git dirs needed for worktree operation (`git-common-dir` + `git-dir`)
  - `/dev` and a minimal temp area (optional)

Network is allowed by default (for “no restrictions inside”), but you can disable it with `--block-network (alias: --no-network)`.

## Tracing sandbox denials (`--trace`)

Seatbelt violations do **not** reliably appear on the target process stderr/stdout; they're recorded in the macOS unified log.
When `--trace` is enabled, macbox:

1) enables `(debug deny)` in the generated SBPL profile
2) after the command exits, queries the unified log for sandbox denial events in the time window
3) writes the output to:

```
<worktree>/.macbox/logs/sandbox-violations.log
```

The unified-log predicate we use is the one commonly recommended for sandbox debugging:

```
(((processID == 0) AND (senderImagePath CONTAINS "/Sandbox")) OR (subsystem == "com.apple.sandbox.reporting")) AND (eventMessage CONTAINS[c] "deny")
```

## Safety boundary note (git worktrees)

Git worktrees store metadata outside the worktree (under the main repo’s `.git/`).
To keep `git status/commit` working inside the sandbox, we explicitly allow access to:
- `git rev-parse --git-common-dir`
- `git rev-parse --git-dir`

These are still limited to **this repo only** (not your whole home directory).

## Profile composer (`--profile`)

Some toolchains are installed in user-owned locations (e.g. `~/.local/bin`, `~/.nvm`, `~/.asdf`).
By default, macbox **does not** grant the sandbox access to your host home directory.

When you *choose* to relax that, you can compose profile snippets via:

```
--profile name[,name2...]
```

Profile search order:

1) `$MACBOX_PROFILES_DIR/<name>.json` (if set)
2) `~/.config/macbox/profiles/<name>.json`
3) Bundled profiles next to the binary (or `<prefix>/share/macbox/profiles`) and `<repo>/profiles/<name>.json`

You can also pass a direct file path as the profile value (e.g. `--profile ./myprofile.json`).

List bundled/user profiles:

```
deno run -A src/main.ts profiles list
deno run -A src/main.ts profiles show host-tools
```

> ⚠️ Profiles can grant *write* access outside the worktree. macbox will warn on stderr when a profile adds writes outside the worktree/git dirs.

---

MIT (c) You

## Capability flags (Step 3)

macbox defaults to a "friendly" sandbox: **network + subprocess execution are allowed**, while **file writes are restricted** to the worktree and a few safe temp roots.

You can override capabilities per run:

- `--allow-network` / `--block-network` (alias: `--no-network`)
- `--allow-exec` / `--block-exec`
- `--allow-fs-read <p1[,p2...]>` adds additional read-only paths
- `--allow-fs-rw <p1[,p2...]>` adds additional writable paths (**you will get a warning** if you grant writes outside the worktree/git dirs)

Examples:

```bash
# Disable network for an agent run
macbox run --agent claude --block-network -- --help

# Add read-only host toolchain paths
macbox run --agent codex --allow-fs-read=/usr/local,/opt/homebrew -- --help

# Add a writable scratch path (discouraged)
macbox run --agent claude --allow-fs-rw=/tmp/my-scratch -- --help
```


## Step 4 — Agent profiles (Claude Code + Codex)

macbox now ships bundled profiles that are auto-applied when you pass `--agent`:

- `agent-claude`: enables Mach service lookups (so Keychain/system IPC works in practice).
- `agent-codex`: enables Mach service lookups (for optional keyring auth) and macbox sets `CODEX_HOME=$HOME/.codex` inside the sandbox.

You can inspect profiles:

```bash
macbox profiles list
macbox profiles show agent-claude
macbox profiles show agent-codex
```

And compose additional profiles as before:

```bash
macbox run --agent codex --profile host-tools -- --help
```


## Sessions (Step 6)

macbox persists a **session record per repo/worktree** so you can quickly re-open a sandbox with the same defaults.

Sessions are stored under:

You can also pass `--session` to `run`/`shell` to reuse a saved worktree and defaults.


- `<base>/sessions/<repoId>/<worktree>.json`
- Default base: `~/.local/share/macbox`

### List sessions

```bash
deno run -A src/main.ts sessions list
# current repo only
deno run -A src/main.ts sessions list --repo .
# filter by agent
deno run -A src/main.ts sessions list --repo . --agent claude
```

### Show a session

```bash
# show latest session (global)
deno run -A src/main.ts sessions show latest

# show latest session for this repo
deno run -A src/main.ts sessions show latest --repo .

# show by id from `sessions list`
deno run -A src/main.ts sessions show <repoId/worktreeName>
```

### Attach (re-open) a session

```bash
# attach latest session (global)
deno run -A src/main.ts attach latest

# attach specific session id
deno run -A src/main.ts attach <repoId/worktreeName>

# attach + run a custom shell command
deno run -A src/main.ts attach <repoId/worktreeName> -- /bin/zsh -l

# attach with tracing
deno run -A src/main.ts attach <repoId/worktreeName> --trace
```

### Clean sessions

```bash
# delete sessions for current repo
deno run -A src/main.ts sessions clean --repo .

# delete all sessions (all repos)
deno run -A src/main.ts sessions clean --all
```


## Skills (Step 7)

Skills are **small, repo-local commands** you can run **inside the same Seatbelt sandbox** as your agent and interactive shell.

Think of them as “named macros” that live *inside the sandbox worktree*:

- **Committed skills**: `<worktree>/skills/<skill>/skill.json`
- **Local-only skills** (gitignored): `<worktree>/.macbox/skills/<skill>/skill.json`

### List skills

```bash
deno run -A src/main.ts skills list --worktree ai
```

Output is tab-separated: `name  scope  dir  description`.

### Init a skill

```bash
# committed (goes under <worktree>/skills/...)
deno run -A src/main.ts skills init fmt --worktree ai

# local-only (goes under <worktree>/.macbox/skills/...)
deno run -A src/main.ts skills init scratch --local --worktree ai
```

The template creates:

- `skill.json` (manifest)
- `run.ts` (entrypoint)
- `README.md`

### Run a skill (inside the sandbox)

```bash
# run the skill command exactly as in skill.json
deno run -A src/main.ts skills run fmt --worktree ai

# pass args after `--` (appended to the manifest command)
deno run -A src/main.ts skills run fmt --worktree ai -- --help

# run with the Codex agent profile (adds Mach lookups + keeps CODEX_HOME in the sandbox)
deno run -A src/main.ts skills run fmt --agent codex --worktree ai-codex -- --help

# trace Seatbelt denials to <worktree>/.macbox/logs/sandbox-violations.log
deno run -A src/main.ts skills run fmt --worktree ai --trace
```

### `skill.json` schema

Minimal manifest:

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
- `cwd` defaults to the skill directory. If `cwd` is relative, it is resolved against the skill directory.
- `env` values support `${WORKTREE}` and `${SKILL_DIR}` expansion.
- macbox also injects:
  - `MACBOX_WORKTREE`
  - `MACBOX_SKILL`
  - `MACBOX_SKILL_DIR`

## Step 8 — Skills registry + runner contract

### A machine-readable registry (for humans **and** agents)

Generate a JSON registry of all skills in a worktree:

```bash
# writes: <worktree>/.macbox/skills/registry.json (gitignored)
deno run -A src/main.ts skills registry --worktree ai --write

# write a committed registry instead (optional)
deno run -A src/main.ts skills registry --worktree ai --write --committed
```

Print the registry to stdout:

```bash
deno run -A src/main.ts skills registry --worktree ai --json
```

The registry includes:
- `name`, `scope` (`local`/`worktree`), `dir` (relative), `manifest.command/cwd`, and `manifest.envKeys`
- the current **skill runner contract** inlined under `contract`

### Inspect + edit skills

```bash
deno run -A src/main.ts skills describe fmt --worktree ai
deno run -A src/main.ts skills describe fmt --worktree ai --json

deno run -A src/main.ts skills path fmt --worktree ai
deno run -A src/main.ts skills path fmt --file run.ts --worktree ai

# opens in $VISUAL or $EDITOR, falling back to `open -t` on macOS
deno run -A src/main.ts skills edit fmt --worktree ai
```

### Skill runner contract (v1)

macbox injects a few env vars for every `skills run`:

- `MACBOX_WORKTREE` — absolute path to the sandbox worktree
- `MACBOX_SKILL` — skill name
- `MACBOX_SKILL_DIR` — absolute path to the skill directory
- `MACBOX_SESSION` — short session id for this invocation
- `MACBOX_SKILL_ARGS_JSON` — JSON array of args passed after `--`

Structured output (optional):

- `MACBOX_RESULT_PATH` — an absolute file path (inside the worktree) where the skill *may* write JSON
- `MACBOX_RESULT_FORMAT` — currently `json`

For a **clean, machine-readable** run output (great for Claude Code / Codex tooling), use:

```bash
deno run -A src/main.ts skills run fmt --worktree ai --json -- --help
```

That prints a single JSON envelope (schema: `macbox.skills.run.v1`) containing:
- `ok`, `exitCode`, `session`
- `skill { name, scope, dir }`
- captured `stdout`/`stderr` (and truncation flags)
- parsed `result` if the skill wrote JSON to `$MACBOX_RESULT_PATH`

You can override the result file location:

```bash
deno run -A src/main.ts skills run fmt --worktree ai --json --result .macbox/tmp/result.json -- --help
```

Print the contract itself:

```bash
deno run -A src/main.ts skills contract
deno run -A src/main.ts skills contract --json
```
