# macbox user guide

macbox gives you a **native macOS sandbox workbench** for running coding agents
(Claude Code, Codex, or any CLI) against **git worktrees**.

It's meant to feel like "let the agent do real work" while still keeping your
laptop sane:

- the agent can install deps, run builds, spawn subprocesses, and (by default)
  use the network
- but it can only **write** inside the worktree + its sandbox home (`.macbox/`)

Beyond sandboxing, macbox provides a complete workspace lifecycle: projects
that track multiple repos, workspaces with archive/restore, composable flows
defined in `macbox.json`, and context packs for reproducible state snapshots.

---

## Mental model

Think of your repo as the **main house**.

A macbox worktree is a **guest house** (separate directory), and the Seatbelt
sandbox is the **lock on the guest house door**:

- ✅ the agent can rearrange furniture inside the guest house (edit files,
  install deps, build, test)
- 🔒 the agent can’t wander into your real home directory (`~/.ssh`,
  `~/Documents`, `~/Library`, etc.) unless you _explicitly_ allow it

---

## Requirements

- macOS
- `git`
- `/usr/bin/sandbox-exec` (macOS Seatbelt launcher)

---

## Quickstart

From inside the `macbox/` folder:

```bash
# show help
deno task dev -- --help

# run Claude Code in a sandboxed worktree (defaults to ai-claude)
deno task dev -- run --agent claude -- --help

# open an interactive shell in the same sandbox
deno task dev -- shell --agent claude

# run Codex in its own sandbox worktree
deno task dev -- run --agent codex --worktree ai-codex -- --help

# use a preset for a complete workflow configuration
deno task dev -- run --preset fullstack-typescript -- --help
deno task dev -- shell --preset python-ml

# create a managed workspace linked to a GitHub issue
deno task dev -- workspace new --agent claude --issue 42

# run a flow defined in macbox.json
deno task dev -- flow run build
```

Tips:

- Running macbox from outside your repo? Add `--repo /path/to/repo`.
- Want a shorter command? Make an alias:

```bash
alias macbox='deno task dev --'
```

Then you can type:

```bash
macbox run --agent claude -- --help
```

---

## What macbox creates

macbox keeps everything it owns under a single **base directory** (default:
`~/.local/share/macbox`).

Inside that base directory:

| Path                                                    | What it is                                                    | Safe to delete? |
| ------------------------------------------------------- | ------------------------------------------------------------- | --------------- |
| `<base>/worktrees/<repoId>/<worktree>`                  | The actual git worktree directory where the agent edits files | Yes             |
| `<base>/sessions/<repoId>/<worktree>.json`              | Saved defaults (agent kind, profiles, caps)                   | Yes             |
| `<base>/workspaces/<projectId>/<workspaceId>.json`      | Workspace records (lifecycle, flow history, context packs)    | Yes             |

macbox also uses a config directory (default: `~/.config/macbox`):

| Path                                     | What it is                  |
| ---------------------------------------- | --------------------------- |
| `~/.config/macbox/projects.json`         | Project registry            |
| `~/.config/macbox/profiles/<name>.json`  | User profiles               |
| `~/.config/macbox/presets/<name>.json`    | User presets                |

Inside each worktree, macbox creates a `.macbox/` folder:

| Path                                         | Purpose                                   |
| -------------------------------------------- | ----------------------------------------- |
| `<worktree>/.macbox/home`                    | Sandbox `HOME`                            |
| `<worktree>/.macbox/cache`                   | XDG caches                                |
| `<worktree>/.macbox/tmp`                     | Sandbox temp                              |
| `<worktree>/.macbox/logs`                    | `--trace` output                          |
| `<worktree>/.macbox/profile.sb`              | Generated Seatbelt policy                 |
| `<worktree>/.macbox/skills`                  | Local-only skills + registry (gitignored) |
| `<worktree>/.macbox/flows`                   | Flow execution results (JSON)             |
| `<worktree>/.macbox/context/packs/<packId>/` | Context pack snapshots                    |

That `.macbox/` folder is **gitignored** in the worktree.

### Moving macbox state

If you want macbox’s state somewhere else, set a base dir:

```bash
macbox shell --agent claude --base ./.macbox_state
```

---

## Core commands

### `macbox run`

Use it when you want to launch an agent CLI (or any command) inside the sandbox.

```bash
# Runs `claude ...` inside a sandboxed worktree
macbox run --agent claude -- --help

# Use a preset for a complete workflow configuration
macbox run --preset fullstack-typescript -- --help

# Custom command (if your agent executable isn't on PATH)
macbox run --cmd /opt/homebrew/bin/claude --worktree ai1 -- --help
```

Everything after `--` is passed directly to the agent command.

### `macbox shell`

Same sandbox policy, but for **you**.

```bash
# Warm shell: auto-applies agent profile, defaults worktree to ai-claude
macbox shell --agent claude

# Use a preset for a complete workflow configuration
macbox shell --preset python-ml

# Explicit shell command
macbox shell --worktree ai -- /bin/zsh -l
```

### `macbox attach`

Reopen a previous sandbox session quickly.

```bash
# Attach to latest session for this repo
macbox attach latest --repo .

# Attach by explicit id (shown in sessions list)
macbox attach <repoId/worktreeName>
```

---

## Sessions (quality-of-life)

Every time you `run`, `shell`, or `skills run`, macbox writes a session record.
Sessions let you:

1. **Attach later**: `macbox attach latest`
2. **Reuse defaults**: `--session latest` to keep the same
   worktree/caps/profiles

Common patterns:

```bash
# list sessions for current repo
macbox sessions list --repo .

# show latest session (helps you find the worktree path)
macbox sessions show latest --repo .

# delete a specific session
macbox sessions delete <id>

# reuse the latest session defaults
macbox shell --session latest --repo .
macbox run --session latest --repo . --agent claude -- --help
```

---

## What’s sandboxed?

By default, macbox is intentionally “friendly inside, strict at the boundary”:

- ✅ **Network allowed** (so agents can fetch deps, call APIs, etc.)
- ✅ **Subprocess execution allowed** (so `git`, `deno`, `node`, `python`, etc.
  work)
- ✅ **Read/execute system paths allowed** (macOS + common tool locations like
  Homebrew)
- 🔒 **Write access limited** to:
  - the worktree path
  - the repo’s git dirs required for worktrees (`git-common-dir` + `git-dir`)
  - minimal `/dev` + temp areas

### The sandbox home / caches

Inside the sandbox, macbox sets:

- `HOME=<worktree>/.macbox/home`
- `XDG_CONFIG_HOME=<worktree>/.macbox/home/.config`
- `XDG_CACHE_HOME=<worktree>/.macbox/cache`
- `TMPDIR=<worktree>/.macbox/tmp`
- `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
- `DENO_DIR=<worktree>/.macbox/cache/deno`
- `NPM_CONFIG_CACHE=<worktree>/.macbox/cache/npm`
- `YARN_CACHE_FOLDER=<worktree>/.macbox/cache/yarn`
- `PNPM_HOME=<worktree>/.macbox/home/.local/share/pnpm`
- `GIT_CONFIG_GLOBAL=<worktree>/.macbox/home/.gitconfig`
- `GIT_CONFIG_SYSTEM=/dev/null`

Codex also gets:

- `CODEX_HOME=$HOME/.codex` (inside the sandbox)

So by default you **don't** accidentally write to your host `~/.codex` or other
personal config dirs.

---

## Capability flags

Sometimes you want to tighten or relax the policy without writing a profile
file.

| Flag                                  | Meaning                         | Typical use                                |
| ------------------------------------- | ------------------------------- | ------------------------------------------ |
| `--block-network` (or `--no-network`) | Disallow outbound network calls | Run untrusted code or force offline builds |
| `--block-exec`                        | Disallow spawning subprocesses  | Tighten sandbox for simple file transforms |
| `--allow-fs-read p1,p2`               | Add extra read-only paths       | Read toolchains in nonstandard locations   |
| `--allow-fs-rw p1,p2`                 | Add extra writable paths        | Rare; only if you truly need host writes   |

Examples:

```bash
# offline agent
macbox run --agent claude --block-network -- --help

# allow reading extra tool paths
macbox run --agent codex --allow-fs-read=/opt/homebrew,/usr/local -- --help
```

macbox will warn if you grant **write** access outside the worktree/git dirs.

---

## Profiles (opt-in relaxations)

Profiles are small JSON snippets that add read/write allowlists. You explicitly
opt into them.

### Listing & inspecting profiles

```bash
macbox profiles list
macbox profiles show host-tools
macbox profiles show agent-claude
macbox profiles show agent-codex
```

### Where profiles live

- Bundled (in this repo): `<macbox-repo>/profiles/<name>.json`
- User-local: `~/.config/macbox/profiles/<name>.json`

### Applying profiles

```bash
# apply one profile
macbox run --agent claude --profile host-tools -- --help

# apply multiple profiles (comma-separated)
macbox run --agent claude --profile host-tools,host-ssh -- --help
```

### Writing your own profile

Create `~/.config/macbox/profiles/my-toolchain.json`:

```json
{
  "name": "my-toolchain",
  "description": "Custom toolchain paths for asdf and npm",
  "read_paths": ["/Users/you/.asdf", "/Users/you/.npm"],
  "write_paths": [],
  "mach_lookup": false
}
```

Profile fields:
- `name`: Profile identifier
- `description`: Human-readable description (optional)
- `read_paths`: Additional read-only paths (not `extraReadPaths`)
- `write_paths`: Additional writable paths (not `extraWritePaths`)
- `mach_lookup`: Allow Mach service lookups — `true` for all, or an array of service names (optional)

Then:

```bash
macbox run --agent claude --profile my-toolchain -- --help
```

---

## Presets (workflow templates)

Presets are **higher-level templates** that bundle together:

- agent type and model
- profiles to compose
- capability flags (network, exec, filesystem)
- environment variables
- worktree naming conventions

Think of profiles as low-level building blocks, and presets as complete workflow configurations.

### Listing & inspecting presets

```bash
macbox presets list
macbox presets show fullstack-typescript
```

### Using a preset

```bash
# Run with a preset
macbox run --preset fullstack-typescript -- --help

# Shell with a preset
macbox shell --preset python-ml

# CLI flags always override preset defaults
macbox run --preset fullstack-typescript --block-network -- --help
macbox shell --preset rust-dev --profile host-ssh
```

### Bundled presets

macbox ships with these presets:

| Preset | Agent | Profiles | Environment | Use case |
|--------|-------|----------|-------------|----------|
| `fullstack-typescript` | claude | host-tools | NODE_ENV=development | Node.js, Deno, npm/pnpm/yarn |
| `python-ml` | claude | host-tools | PYTHONDONTWRITEBYTECODE=1 | Python, pip, pyenv, virtualenvs |
| `rust-dev` | claude | host-tools | RUST_BACKTRACE=1 | Cargo, rustup, Rust toolchain |
| `ralph-typescript` | claude | host-tools | - | Ralph loop with typecheck + test gates |

### Creating your own preset

```bash
# Create from a template
macbox presets create my-workflow --template fullstack-typescript

# Create a blank preset
macbox presets create my-workflow

# Edit the preset
macbox presets edit my-workflow
```

User presets are stored in `~/.config/macbox/presets/<name>.json`.

Preset search order:
1. `$MACBOX_PRESETS_DIR/<name>.json` (if set)
2. `~/.config/macbox/presets/<name>.json`
3. Bundled presets next to the binary (or `<prefix>/share/macbox/presets`)

### Preset schema

```json
{
  "name": "my-workflow",
  "description": "My custom development workflow",
  "agent": "claude",
  "model": "claude-sonnet-4-20250514",
  "apiKeyEnv": "ANTHROPIC_API_KEY",
  "cmd": "/opt/homebrew/bin/claude",
  "profiles": ["host-tools", "host-ssh"],
  "capabilities": {
    "network": true,
    "exec": true,
    "extraReadPaths": ["/opt/homebrew", "~/.nvm", "~/.deno"],
    "extraWritePaths": []
  },
  "env": {
    "NODE_ENV": "development",
    "DEBUG": "true"
  },
  "worktreePrefix": "ai-myworkflow",
  "startPoint": "main"
}
```

Field reference:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Preset identifier |
| `description` | string | Human-readable description |
| `agent` | string | `claude`, `codex`, or `custom` |
| `model` | string | Model ID (written to agent config in sandbox) |
| `apiKeyEnv` | string | Name of env var holding the API key |
| `cmd` | string | Explicit path to the agent executable |
| `profiles` | array | Profile names to compose |
| `capabilities.network` | boolean | Allow outbound network |
| `capabilities.exec` | boolean | Allow subprocess execution |
| `capabilities.extraReadPaths` | array | Additional read-only paths |
| `capabilities.extraWritePaths` | array | Additional writable paths |
| `env` | object | Environment variables to inject |
| `worktreePrefix` | string | Default worktree name prefix |
| `startPoint` | string | Default git ref for new worktrees |
| `ralph` | object | Ralph loop defaults (maxIterations, qualityGates, commitOnPass) |

### How preset + CLI flags interact

Precedence (highest to lowest):

1. **CLI flags** (`--block-network`, `--profile`, etc.)
2. **Session defaults** (from `--session`)
3. **Preset defaults**
4. **Hardcoded defaults**

So you can use a preset as a baseline and override specific settings per-run.

### Preset tracking in sessions

When you use a preset, macbox records it in the session:

```bash
macbox run --preset fullstack-typescript -- --help
macbox sessions show latest --repo .
# Shows: "preset": "fullstack-typescript"
```

When you `attach` to that session, the preset is automatically reloaded.

### Deleting presets

```bash
# Only user-created presets can be deleted
macbox presets delete my-workflow
```

Bundled presets cannot be deleted (they ship with macbox).

---

## Debugging "Permission denied" with `--trace`

Seatbelt denials usually go to the macOS unified log (not your process stderr).
When you run with `--trace`, macbox:

1. enables sandbox debug denies in the generated profile
2. after the run finishes, queries the unified log for the time window
3. writes a report to: `<worktree>/.macbox/logs/sandbox-violations.log`

Example:

```bash
macbox run --agent claude --trace -- --help
```

If something fails, open the report:

```bash
macbox sessions show latest --repo .
# (look for the worktree path)
open <worktree>/.macbox/logs/sandbox-violations.log
```

---

## Skills: sandbox tools you can rely on

Skills are **small, repeatable tools** that always run **inside the same sandbox
boundary** as your agent.

Use them for things you want to be:

- easy to re-run
- reviewable
- safe-by-default (no reaching into your host)

### Where skills live

Skills live **inside the worktree**, in one of two places:

- **Committed skills** (share with team / keep in git):
  - `<worktree>/skills/<skill>/skill.json`
- **Local-only skills** (private; gitignored):
  - `<worktree>/.macbox/skills/<skill>/skill.json`

Important: **local skills override committed skills with the same name** (handy
for personal variants).

### Skill manifest (`skill.json`)

A skill is defined by `skill.json`:

```json
{
  "name": "fmt",
  "description": "Format the repo",
  "command": ["deno", "fmt"],
  "cwd": ".",
  "env": {
    "EXAMPLE": "hello-from-${SKILL_DIR}"
  }
}
```

Notes:

- `command` is an argv array (no shell by default).
- `cwd` is resolved relative to the skill directory.
- `env` values may use:
  - `${WORKTREE}` = worktree root
  - `${SKILL_DIR}` = absolute skill directory

### Skill commands

```bash
# list skills
macbox skills list --worktree ai

# create a new committed skill
macbox skills init fmt --worktree ai

# create a local-only skill (gitignored)
macbox skills init my-private-skill --local --worktree ai

# inspect/edit
macbox skills describe fmt --worktree ai
macbox skills edit fmt --worktree ai
macbox skills path fmt --file run.ts --worktree ai
```

### Running a skill

```bash
# pass args after `--`
macbox skills run fmt --worktree ai -- --check
```

Skill runs support the same sandbox knobs as `run/shell`:

```bash
macbox skills run fmt --worktree ai --block-network -- --check
macbox skills run fmt --worktree ai --profile host-tools -- --check

# Write structured result to a custom path
macbox skills run fmt --worktree ai --result output.json
```

### Skill runner contract (v1)

macbox injects a few env vars when executing a skill:

- `MACBOX_WORKTREE`: absolute worktree path
- `MACBOX_SKILL`: skill name
- `MACBOX_SKILL_DIR`: absolute skill directory
- `MACBOX_SESSION`: a short session id for the invocation
- `MACBOX_SKILL_ARGS_JSON`: JSON array of args passed after `--`
- `MACBOX_RESULT_PATH`: absolute path to write a JSON result (optional)
- `MACBOX_RESULT_FORMAT`: defaults to `json`

You can view the contract any time:

```bash
macbox skills contract
macbox skills contract --json
```

### Structured output for agents (`skills run --json`)

If you want a clean machine-readable payload, run:

```bash
macbox skills run fmt --worktree ai --json -- --check
```

macbox will:

1. capture stdout/stderr
2. look for JSON at `$MACBOX_RESULT_PATH`
3. print a single JSON envelope (`macbox.skills.run.v1`) to stdout

If your skill writes JSON to `$MACBOX_RESULT_PATH`, it will show up as `result`
in the envelope.

If you want capture without an envelope, use `--capture`.

### Skills registry (machine-readable list)

To generate a registry (for humans or agents) you can:

```bash
# print a summary
macbox skills registry --worktree ai

# print full JSON registry to stdout
macbox skills registry --worktree ai --json

# write a local registry file (gitignored)
macbox skills registry --worktree ai --write
# -> <worktree>/.macbox/skills/registry.json

# write a committed registry file
macbox skills registry --worktree ai --write --committed
# -> <worktree>/skills/registry.json
```

---

## Worked example: a “repo summary” skill with JSON output

1. Create a skill:

```bash
macbox skills init repo-summary --worktree ai
macbox skills edit repo-summary --file run.ts --worktree ai
```

2. Replace `run.ts` with something like:

```ts
// repo-summary/run.ts
const worktree = Deno.env.get("MACBOX_WORKTREE") ?? "";
const args = Deno.args;

const out = {
  worktree,
  args,
  topLevelEntries: 0,
};

let count = 0;
for await (const _e of Deno.readDir(worktree)) count++;
out.topLevelEntries = count;

// Optional structured result:
const resultPath = Deno.env.get("MACBOX_RESULT_PATH");
if (resultPath) {
  await Deno.writeTextFile(resultPath, JSON.stringify(out, null, 2) + "\n");
}

console.log(JSON.stringify(out, null, 2));
```

3. Run with `--json`:

```bash
macbox skills run repo-summary --worktree ai --json -- --fast
```

You’ll get a single envelope like:

```json
{
  "schema": "macbox.skills.run.v1",
  "ok": true,
  "exitCode": 0,
  "session": "abc123",
  "skill": {
    "name": "repo-summary",
    "scope": "worktree",
    "dir": "skills/repo-summary"
  },
  "resultPath": ".macbox/tmp/skill-result-abc123.json",
  "result": { "worktree": "...", "args": ["--fast"], "topLevelEntries": 12 },
  "resultError": null,
  "stdout": "...",
  "stderr": "",
  "stdoutTruncated": false,
  "stderrTruncated": false
}
```

---

## Projects (multi-repo awareness)

Projects register repos so macbox can track workspaces across multiple
repositories. Each project is identified by a hash of its repo path (the same
`repoId` used internally by sessions).

```bash
# Register the current repo
macbox project add

# Register with options
macbox project add --name my-app --repo /path/to/repo --agent claude

# List and inspect
macbox project list
macbox project show my-app

# Remove from registry
macbox project remove my-app
```

Projects are stored in `~/.config/macbox/projects.json`. If you run
`macbox workspace new` without a registered project, macbox auto-creates one.

---

## Workspaces (managed lifecycle)

Workspaces sit above sessions: they track a (project, worktree, session) triple
with a lifecycle you control. Each workspace has a status (`active` or
`archived`), optional issue/branch linkage, and records flow runs and context
packs over time.

Existing `macbox run/shell/attach` commands work exactly as before. Workspaces
are opt-in - you adopt them when you need lifecycle management.

### Creating a workspace

```bash
# Basic workspace
macbox workspace new --agent claude

# Link to an issue (worktree auto-named ws-issue-42)
macbox workspace new --agent claude --issue 42

# With preset and custom label
macbox workspace new --preset fullstack-typescript --name auth-refactor

# Explicit branch and worktree name
macbox workspace new --agent claude --branch feature/login --worktree ws-login
```

Workspace creation does all the plumbing: detects the repo, finds or creates a
project entry, creates a git worktree, sets up sandbox directories, saves a
session record, and creates the workspace file.

> Note: `onWorkspaceCreate` is defined in the `macbox.json` hook schema but is **not yet invoked** by `macbox workspace new`.

### Listing and inspecting

```bash
macbox workspace list                 # active workspaces, current repo
macbox workspace list --archived      # archived only
macbox workspace list --all           # everything
macbox workspace show <id>            # full workspace details
```

`macbox ws` is a shorthand alias for `macbox workspace`.

### Opening a workspace

```bash
macbox workspace open <id>
```

This prints the workspace's session info (session ID, worktree path) and the `macbox attach` command to run. It does **not** directly launch a sandbox — use the printed `macbox attach` command to actually enter the sandbox.

### Archive and restore

Archiving freezes a workspace. Restoring brings it back.

```bash
# Archive (marks as archived, creates a context pack)
macbox workspace archive <id>

# Archive and evict the worktree from disk
# (keeps the git branch and all metadata; saves disk space)
macbox workspace archive <id> --evict

# Restore (re-creates worktree if evicted, runs onWorkspaceRestore hook)
macbox workspace restore <id>
```

The eviction model: when you `--evict`, macbox captures a context pack of the
current state, records the branch pointer, removes the worktree directory, and
marks `worktreeEvicted: true` in the archive record. When you restore, macbox
re-creates the worktree from the saved branch and runs any configured hooks.

---

## Flows (composable step pipelines)

A flow is to the agent what a CI pipeline is to your repo - except it runs
locally, inside the sandbox.

Flows are named step sequences defined in `macbox.json` at the repo or
worktree root. Steps execute sequentially. A non-zero exit code halts the
flow unless `continueOnError: true` is set on that step.

### `macbox.json` example

```json
{
  "schema": "macbox.config.v1",
  "defaults": {
    "agent": "claude",
    "preset": "fullstack-typescript",
    "profiles": ["host-tools"]
  },
  "flows": {
    "build": {
      "description": "Install, build, and test",
      "steps": [
        { "id": "install", "type": "steps:shell", "label": "Install deps", "args": { "cmd": "npm install" } },
        { "id": "build", "type": "steps:shell", "args": { "cmd": "npm run build" } },
        { "id": "test", "type": "steps:shell", "args": { "cmd": "npm test" }, "continueOnError": true }
      ]
    },
    "merge-main": {
      "description": "Fetch and attempt merge from main",
      "steps": [
        { "id": "fetch", "type": "steps:git.fetch" },
        { "id": "merge", "type": "steps:git.merge", "args": { "branch": "origin/main" } },
        { "id": "conflicts", "type": "steps:git.conflictList" }
      ]
    },
    "pr-submit": {
      "description": "Commit, push, and create PR",
      "steps": [
        { "id": "add", "type": "steps:git.add" },
        { "id": "commit", "type": "steps:git.commit", "args": { "message": "Automated commit" } },
        { "id": "pr", "type": "steps:gh.prCreate", "args": { "title": "Feature PR", "body": "Automated" } }
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

Each step supports an optional `label` field (string) for human-readable display during flow execution.

**Shell:**

- `steps:shell` - runs a bash command. Args: `cmd` (string).

**Git operations:**

- `steps:git.diff` - shows working tree diff
- `steps:git.status` - porcelain status output
- `steps:git.checkout` - checkout a branch. Args: `branch` (string).
- `steps:git.pull` - pull from remote
- `steps:git.commit` - commit. Args: `message` (string), optional `all` (boolean) to stage everything first.
- `steps:git.fetch` - fetch from remote
- `steps:git.merge` - merge a branch. Args: `branch` (string).
- `steps:git.conflictList` - list conflicted files
- `steps:git.add` - stage files. Optional args: `files` (string array). Defaults to `git add -A`.

**Agent:**

- `steps:agent.run` - launches the configured agent inside the sandbox. Optional args: `passthrough` (string array) for extra CLI flags.

**GitHub (requires `gh` CLI):**

- `steps:gh.issueGet` - fetch issue details. Args: `number` (integer).
- `steps:gh.prGet` - fetch PR details. Args: `number` (integer).
- `steps:gh.prCreate` - create a PR. Args: `title` (string), optional `body`, `base`, `head`.
- `steps:gh.prMerge` - merge a PR. Args: `number` (integer), optional `method` (merge/squash/rebase).

**Skills:**

- `skills:<name>` - runs a named skill. Optional args: `skillArgs` (string array).

**Ralph:**

- `steps:ralph.run` - runs the Ralph autonomous loop. Args: `prd` (string path or inline object) or `prompt` (string), optional `config` (Ralph config overrides).

### Step outputs and variable passing

Every step produces an `outputs` map that downstream steps can reference. All
steps populate `outputs.result` with their trimmed stdout. Some steps parse
additional structured fields into outputs:

- `steps:gh.issueGet` adds `title`, `body`, `url`, `state`
- `steps:gh.prGet` adds `title`, `body`, `url`, `state`, `headRefName`, `baseRefName`
- `steps:gh.prCreate` adds `url`

To reference a previous step's output, use `${steps.<stepId>.<path>}` in any
string value inside step `args`. Supported paths:

- `outputs.<key>` - a named output (e.g. `${steps.build.outputs.result}`)
- `stdout` - raw stdout (not trimmed)
- `stderr` - raw stderr
- `exitCode` - numeric exit code as a string

If a referenced step ID does not exist or the output key is missing, the
expression resolves to an empty string. This makes it safe to reference
optional earlier steps.

**Example: chaining shell outputs**

```json
{
  "flows": {
    "version-tag": {
      "steps": [
        { "id": "ver", "type": "steps:shell", "args": { "cmd": "cat VERSION" } },
        { "id": "tag", "type": "steps:shell", "args": { "cmd": "git tag v${steps.ver.outputs.result}" } }
      ]
    }
  }
}
```

**Example: issue-driven PR creation**

```json
{
  "flows": {
    "issue-pr": {
      "steps": [
        { "id": "issue", "type": "steps:gh.issueGet", "args": { "number": 42 } },
        { "id": "pr", "type": "steps:gh.prCreate", "args": {
            "title": "${steps.issue.outputs.title}",
            "body": "Closes #42\n\n${steps.issue.outputs.body}"
          }
        }
      ]
    }
  }
}
```

### Running flows

```bash
# Run a flow
macbox flow run build

# Run in a specific workspace (updates the workspace's flowsRun history)
macbox flow run build --workspace ws-abc123

# JSON output
macbox flow run build --json

# List flows defined in macbox.json
macbox flow list

# Show a flow's definition
macbox flow show build
```

Flow results are saved to `<worktree>/.macbox/flows/<flowName>-<timestamp>.json`
with schema `macbox.flow.result.v1`, containing the flow name, per-step results
(including each step's `outputs` map), overall success/failure, and timing data.

### Hooks

Hooks are arrays of steps defined in `macbox.json` for workspace lifecycle points.
They use the same step types as flows:

- `onWorkspaceCreate` - defined in schema but **not yet invoked** by `macbox workspace new`
- `onWorkspaceRestore` - runs after `macbox workspace restore`
- `onFlowComplete` - defined in schema but **not yet invoked** after flow completion

---

## Ralph (autonomous agent loop)

Ralph is an autonomous loop that iterates over a PRD (Product Requirements
Document), spawning a fresh sandboxed agent per iteration, running quality
gates after each, and committing passing work until all stories pass or the
iteration limit is reached.

### When to use Ralph

Use Ralph when you have a multi-step feature to implement and want the agent
to work through it autonomously with quality verification at each step. Ralph
is particularly useful when:

- You have a PRD with multiple user stories to implement in order
- You want automatic quality gates (typecheck, tests, linting) after each iteration
- You want each passing story committed automatically
- You need the agent to build on its own progress across iterations

### Quick start

```bash
# Simple: free-form prompt generates a single-story PRD
macbox ralph "Add a search endpoint to the API"

# Full: multi-story PRD with quality gates
macbox ralph prd.json --agent claude --gate "typecheck:npx tsc --noEmit" --gate "test:npm test"

# Using a preset with pre-configured gates
macbox ralph prd.json --preset ralph-typescript
```

### Writing a PRD

A PRD is a JSON file describing the project and its user stories. Stories are
processed in priority order (lowest number first).

```json
{
  "project": "my-api",
  "description": "REST API for user management",
  "userStories": [
    {
      "id": "US-001",
      "title": "Add /users endpoint",
      "description": "Create a GET endpoint that returns all users",
      "acceptanceCriteria": ["Returns JSON array", "Handles empty DB"],
      "priority": 1,
      "passes": false
    },
    {
      "id": "US-002",
      "title": "Add user creation",
      "description": "Create a POST /users endpoint",
      "acceptanceCriteria": ["Validates input", "Returns 201"],
      "priority": 2,
      "passes": false
    }
  ]
}
```

The `id` and `priority` fields are auto-assigned if omitted. The `passes` field
defaults to `false`. As stories pass quality gates, Ralph updates `prd.json`
in-place and commits it alongside the code.

### How it works

Each iteration of the Ralph loop:

1. Selects the highest-priority incomplete story (lowest priority number,
   `passes === false`)
2. Builds a prompt containing the story details, PRD overview with completion
   status, and accumulated progress notes from prior iterations
3. Spawns a sandboxed agent with the prompt as a positional argument
4. If the agent exits with code 0, runs quality gates outside the sandbox
5. If all gates pass and `commitOnPass` is true, commits the work and marks
   the story as passed in `prd.json`
6. If the agent fails (non-zero exit), the story stays incomplete and will be
   retried in the next iteration

The loop terminates when one of three conditions is met:

- **all_passed**: every story's `passes` field is `true`
- **max_iterations**: the iteration limit was reached (default: 10)
- **completion_signal**: the agent output `<promise>COMPLETE</promise>`

### CLI reference

```
macbox ralph <prompt-or-prd-path>
  [--agent claude|codex]        Agent to use
  [--cmd <path>]                Explicit agent executable path
  [--preset <name>]             Apply a preset (merges ralph config)
  [--max-iterations <N>]        Override max iterations (default: 10)
  [--gate "name:cmd"]           Add a quality gate (repeatable, comma-separated)
  [--no-commit]                 Skip git commits on passing iterations
  [--profile <name[,name2...]>] Compose sandbox profiles
  [--worktree <name>]           Explicit worktree name
  [--branch <start-point>]      Git ref for the worktree
  [--debug] [--trace] [--json]  Debugging and output flags
  [--repo <path>] [--base <path>]
```

The positional argument is either a free-form prompt string (which generates a
single-story PRD) or a path to a `prd.json` file. If it ends with `.json`,
macbox looks for the file in the worktree first, then as an absolute path, then
relative to cwd.

### Quality gates

Gates are shell commands that run outside the sandbox in the worktree after
each agent iteration. They only execute when the agent exits successfully
(code 0).

```bash
# Add gates via CLI flags
macbox ralph prd.json --gate "typecheck:npx tsc --noEmit" --gate "test:npm test"

# Or configure them in a preset
macbox ralph prd.json --preset ralph-typescript
```

In a preset, each gate can also specify `continueOnFail: true` to log the
failure but continue running subsequent gates. Without it, the first failing
gate stops the sequence for that iteration.

### State and progress

Ralph persists its state in the worktree under `.macbox/ralph/` (gitignored):

| File | Contents |
|------|----------|
| `state.json` | Full iteration history, PRD state, config |
| `progress.txt` | Append-only iteration log, fed back into agent prompts |

The `prd.json` file is updated in-place as stories pass and committed alongside
the code. This means you can inspect `prd.json` at any point to see which
stories have been completed.

### Ralph in flows

Ralph is also available as the `steps:ralph.run` step type in flows defined
in `macbox.json`. This lets you compose Ralph with other steps:

```json
{
  "flows": {
    "implement-and-pr": {
      "description": "Implement from PRD then open a PR",
      "steps": [
        {
          "id": "ralph",
          "type": "steps:ralph.run",
          "args": {
            "prd": "prd.json",
            "config": {
              "maxIterations": 15,
              "qualityGates": [
                { "name": "typecheck", "cmd": "npx tsc --noEmit" },
                { "name": "test", "cmd": "npm test" }
              ]
            }
          }
        },
        {
          "id": "pr",
          "type": "steps:gh.prCreate",
          "args": { "title": "Implement PRD stories", "body": "Ralph: ${steps.ralph.outputs.result}" }
        }
      ]
    }
  }
}
```

Or with a free-form prompt instead of a PRD file:

```json
{ "id": "impl", "type": "steps:ralph.run", "args": { "prompt": "Add dark mode to settings" } }
```

The step outputs include `terminationReason` and `iterationsRun` for
interpolation by downstream steps.

### Configuring Ralph in presets

Presets can include a `ralph` field with default loop configuration:

```json
{
  "name": "ralph-typescript",
  "agent": "claude",
  "profiles": ["host-tools"],
  "capabilities": { "network": true, "exec": true },
  "worktreePrefix": "ralph-ts",
  "ralph": {
    "maxIterations": 10,
    "qualityGates": [
      { "name": "typecheck", "cmd": "npx tsc --noEmit" },
      { "name": "test", "cmd": "npm test" }
    ],
    "commitOnPass": true
  }
}
```

CLI flags always override preset defaults. Preset quality gates and CLI
`--gate` flags are merged (both apply).

### Environment variables

Each Ralph iteration injects these extra env vars into the agent sandbox:

- `MACBOX_RALPH_ITERATION`: current iteration number (1-based)
- `MACBOX_RALPH_STORY_ID`: the story being worked on (e.g. `US-001`)
- `MACBOX_RALPH_MAX_ITERATIONS`: total iteration limit

---

## Context packs (state snapshots)

A context pack is a reproducible snapshot of the repo state at a specific
moment. It captures everything an agent needs to understand where things stand:
the current branch, commit SHA, dirty status, modified file list, the full
diff, and recent git log.

Context packs are useful for:

- bookmarking state before archiving a workspace
- handing off context between agents
- recording what the repo looked like when a flow ran

### Creating and using packs

```bash
# Snapshot the current worktree
macbox context pack

# For a specific workspace
macbox context pack --workspace ws-abc123

# With a custom summary
macbox context pack --summary "Pre-merge state for issue #42"

# List packs (most recent first)
macbox context list

# Inspect a pack
macbox context show <packId>
```

### What's in a pack

Packs live under `<worktree>/.macbox/context/packs/<packId>/`:

| File | Contents |
|------|----------|
| `pack.json` | Metadata: packId, workspaceId, timestamp, repo state |
| `repo_state.json` | Branch, commit SHA, dirty flag, modified files list, untracked count |
| `diff.patch` | Full `git diff` output |
| `summary.md` | Human-readable summary |
| `notes.md` | Free-form notes (initially empty, edit as needed) |
| `commands.log` | Recent git log (last 10 commits) |

---

## Troubleshooting & FAQ

### “sandbox-exec: No such file or directory”

macbox requires `/usr/bin/sandbox-exec`. On current macOS releases it exists. If
it’s missing, you’ll need a different launcher strategy (future work: signed
helper using sandbox APIs).

### “Permission denied” reading something

That’s usually the sandbox boundary doing its job. Fix options:

- one-off: `--allow-fs-read=/path1,/path2`
- repeatable: create a profile under `~/.config/macbox/profiles/` and use
  `--profile my-toolchain`
- debug: re-run with `--trace` and inspect
  `<worktree>/.macbox/logs/sandbox-violations.log`

### “My agent can’t find its executable”

Either:

- install it so it’s on your PATH when you run macbox, or
- provide an explicit path: `macbox run --cmd /opt/homebrew/bin/claude ...`

### “I need git push / SSH keys”

By default the sandbox can’t read `~/.ssh`. That’s intentional.

Options:

- opt-in: `--profile host-ssh` (weakens the boundary; use carefully)
- safer: copy only what you need into `<worktree>/.macbox/home/.ssh`
  (local-only, gitignored)

### “Worktree got weird / I want to reset”

Clean up and recreate:

```bash
macbox clean --worktree ai --repo .
macbox run --agent claude --worktree ai --repo . -- --help
```

### “Can I keep skills global (outside the worktree)?”

Not in the current design. Skills are worktree-contained by design to keep the
boundary simple and portable.

---

## What's next?

Now that you know the basics:

- **Try a preset**: `macbox shell --preset fullstack-typescript` gives you a
  complete TypeScript development environment
- **Create your own preset**: `macbox presets create my-workflow --template fullstack-typescript`
- **Build skills**: Define repeatable sandbox tools your agents can use
- **Use workspaces**: `macbox workspace new --agent claude --issue 42` to create
  a managed workspace linked to a GitHub issue
- **Define flows**: Add a `macbox.json` to your repo root with build/test/deploy
  step sequences
- **Run Ralph**: `macbox ralph prd.json --preset ralph-typescript` to let an
  agent implement a full PRD autonomously with quality gates
- **Capture context**: `macbox context pack` before archiving to preserve state
