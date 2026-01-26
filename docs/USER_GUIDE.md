# macbox user guide

macbox gives you a **native macOS sandbox** for running coding agents (Claude
Code, Codex, or any CLI) against a **git worktree**.

It’s meant to feel like “let the agent do real work” while still keeping your
laptop sane:

- the agent can install deps, run builds, spawn subprocesses, and (by default)
  use the network
- but it can only **write** inside the worktree + its sandbox home (`.macbox/`)

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

| Path                                       | What it is                                                    | Safe to delete? |
| ------------------------------------------ | ------------------------------------------------------------- | --------------- |
| `<base>/worktrees/<repoId>/<worktree>`     | The actual git worktree directory where the agent edits files | Yes             |
| `<base>/sessions/<repoId>/<worktree>.json` | Saved defaults (agent kind, profiles, caps)                   | Yes             |

Inside each worktree, macbox creates a `.macbox/` folder:

| Path                            | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `<worktree>/.macbox/home`       | Sandbox `HOME`                            |
| `<worktree>/.macbox/cache`      | XDG caches                                |
| `<worktree>/.macbox/tmp`        | Sandbox temp                              |
| `<worktree>/.macbox/logs`       | `--trace` output                          |
| `<worktree>/.macbox/profile.sb` | Generated Seatbelt policy                 |
| `<worktree>/.macbox/skills`     | Local-only skills + registry (gitignored) |

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

# Custom command (if your agent executable isn't on PATH)
macbox run --cmd /opt/homebrew/bin/claude --worktree ai1 -- --help
```

Everything after `--` is passed directly to the agent command.

### `macbox shell`

Same sandbox policy, but for **you**.

```bash
# Warm shell: auto-applies agent profile, defaults worktree to ai-claude
macbox shell --agent claude

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

Codex also gets:

- `CODEX_HOME=$HOME/.codex` (inside the sandbox)

So by default you **don’t** accidentally write to your host `~/.codex` or other
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
  "extraReadPaths": ["/Users/you/.asdf", "/Users/you/.npm"],
  "extraWritePaths": []
}
```

Then:

```bash
macbox run --agent claude --profile my-toolchain -- --help
```

---

## Debugging “Permission denied” with `--trace`

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
```

### Skill runner contract (v1)

macbox injects a few env vars when executing a skill:

- `macbox_WORKTREE`: absolute worktree path
- `macbox_SKILL`: skill name
- `macbox_SKILL_DIR`: absolute skill directory
- `macbox_SESSION`: a short session id for the invocation
- `macbox_SKILL_ARGS_JSON`: JSON array of args passed after `--`
- `macbox_RESULT_PATH`: absolute path to write a JSON result (optional)
- `macbox_RESULT_FORMAT`: defaults to `json`

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
2. look for JSON at `$macbox_RESULT_PATH`
3. print a single JSON envelope (`macbox.skills.run.v1`) to stdout

If your skill writes JSON to `$macbox_RESULT_PATH`, it will show up as `result`
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
const worktree = Deno.env.get("macbox_WORKTREE") ?? "";
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
const resultPath = Deno.env.get("macbox_RESULT_PATH");
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
  "skill": {
    "name": "repo-summary",
    "scope": "worktree",
    "dir": "skills/repo-summary"
  },
  "result": { "worktree": "...", "args": ["--fast"], "topLevelEntries": 12 },
  "stdout": "...",
  "stderr": ""
}
```

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

That’s it. If you want, the next ergonomic upgrade is: auto-writing the skills
registry file on `shell --agent ...` and `run --agent ...` so agents always have
a current `.macbox/skills/registry.json` to consult.
