# Changelog

All notable changes to macbox will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-01-31

### Summary

Major simplification release. Removed 5,570 lines (63% of the 0.7.0 codebase) to
focus on core mission: running AI agents safely in macOS sandboxes using git
worktrees.

The codebase went from 12 concepts to 4 core concepts:

1. **Agents**: Claude or Codex executables
2. **Worktrees**: Isolated git branches
3. **Sandboxes**: Seatbelt policies + profiles
4. **Sessions**: Persistent sandbox configurations

### Breaking Changes

#### Removed: Ralph Autonomous Loop (2,373 lines)

Ralph has been extracted to a separate tool:
[ralph-cli](https://github.com/srdjan/ralph-cli)

**Before:**

```bash
macbox --ralph prd.json --gate "test:deno test -A"
```

**After:**

```bash
# Install ralph-cli separately
ralph prd.json --gate "test:deno test -A"
# Ralph calls macbox internally for each iteration
```

**Migration:** Ralph users should install ralph-cli as a separate tool. Ralph
will invoke macbox for agent execution.

#### Removed: Flows System (874 lines)

Flows were composable CI-like pipelines defined in macbox.json.

**Migration:** Replace flows with shell scripts, Makefiles, or actual CI tools
(GitHub Actions, etc.)

**Before (flows):**

```json
{
  "flows": {
    "build": {
      "steps": [
        {
          "id": "install",
          "type": "steps:shell",
          "args": { "cmd": "npm install" }
        },
        { "id": "test", "type": "steps:shell", "args": { "cmd": "deno test" } }
      ]
    }
  }
}
```

**After (shell script):**

```bash
# scripts/build.sh
#!/usr/bin/env bash
set -e
npm install
deno test

# Run via agent
macbox --prompt "run ./scripts/build.sh"
```

#### Removed: Skills System (796 lines)

Skills were repo-local commands that ran in the sandbox.

**Migration:** Replace skills with regular shell scripts.

**Before:**

```bash
macbox skills run fmt --worktree ai
```

**After:**

```bash
# Create script: scripts/fmt.sh
#!/usr/bin/env bash
deno fmt

# Run via agent
macbox --prompt "run ./scripts/fmt.sh"
```

#### Removed: Context Packs (351 lines)

Context packs captured repo snapshots for handoff.

**Migration:** Use git directly for snapshots.

**Before:**

```bash
macbox context pack --summary "Pre-merge state"
```

**After:**

```bash
# Use git's built-in tools
git stash save "Pre-merge state"
# or
git diff > snapshot.patch
# or
git format-patch HEAD~1
```

#### Removed: Projects Registry (129 lines)

Projects registered repos with metadata.

**Migration:** Use macbox.json for per-repo configuration.

**Before:**

```bash
macbox project add --preset fullstack-typescript
```

**After:**

```json
// macbox.json in repo root
{
  "schema": "macbox.config.v1",
  "defaults": {
    "preset": "fullstack-typescript"
  }
}
```

#### Removed: Hooks (39 lines)

Lifecycle hooks (onWorkspaceCreate, onWorkspaceRestore, onFlowComplete).

**Migration:** Hooks were partially implemented and rarely used. Use shell
scripts for lifecycle operations.

#### Simplified: Workspaces (reduced by 462 lines)

Workspaces are now simplified to "named sessions" without archive/restore
functionality.

**Removed commands:**

- `macbox workspace archive`
- `macbox workspace restore`

**Removed fields from WorkspaceRecord:**

- `status` (active/archived)
- `parent`
- `flowRuns`
- `contextPacks`
- `issue`

**Migration:** Use git worktree commands directly for worktree management.

**Before:**

```bash
macbox workspace archive ws-abc123 --evict
macbox workspace restore ws-abc123
```

**After:**

```bash
# List worktrees
git worktree list

# Remove worktree
macbox clean --worktree <name>

# Recreate when needed
macbox --worktree <name> --prompt "..."
```

#### Simplified: Presets System (reduced by 448 lines)

Presets are now focused solely on sandbox configuration.

**Removed from preset schema:**

- `ralph` - Use ralph-cli separately
- `skills` - Use shell scripts
- `model` - Configure in agent's config file
- `apiKeyEnv` - Use standard env vars (ANTHROPIC_API_KEY)
- `cmd` - Use --cmd flag if needed

**Removed preset management commands:**

- `macbox presets create`
- `macbox presets edit`
- `macbox presets delete`

**Removed bundled presets:**

- `python-ml.json`
- `rust-dev.json`
- `ralph-typescript.json`
- `ralph-multi-agent.json`

**Kept:**

- `fullstack-typescript.json` (as example)

**Migration:** Edit preset JSON files directly in `~/.config/macbox/presets/`.
Remove `ralph` and `skills` fields from existing presets.

#### Simplified: macbox.json Schema

**Before:**

```json
{
  "schema": "macbox.config.v1",
  "defaults": { "agent": "claude", "preset": "my-preset", "profiles": ["host-tools"] },
  "flows": { "build": { "steps": [...] } },
  "hooks": { "onWorkspaceCreate": [...] }
}
```

**After:**

```json
{
  "schema": "macbox.config.v1",
  "defaults": {
    "agent": "claude",
    "preset": "my-preset",
    "profiles": ["host-tools"]
  }
}
```

### Removed CLI Commands

The following commands have been removed:

```bash
# Ralph
macbox --ralph <prd>

# Flows
macbox flow run <name>
macbox flow list
macbox flow show <name>

# Skills
macbox skills list
macbox skills describe <name>
macbox skills init <name>
macbox skills run <name>
macbox skills edit <name>
macbox skills path <name>
macbox skills registry
macbox skills contract

# Context packs
macbox context pack
macbox context list
macbox context show <packId>

# Projects
macbox project add
macbox project list
macbox project show <name>
macbox project remove <name>

# Workspace archive/restore
macbox workspace archive <id>
macbox workspace restore <id>

# Preset management
macbox presets create <name>
macbox presets edit <name>
macbox presets delete <name>
```

### Kept CLI Commands

The simplified CLI surface includes:

```bash
# Core
macbox --prompt <text> [options] [-- <agent args>]

# Sessions
macbox sessions list
macbox sessions show <id>
macbox sessions delete <id>
macbox sessions clean

# Profiles
macbox profiles list
macbox profiles show <name>

# Presets
macbox presets list
macbox presets show <name>

# Workspaces (simplified)
macbox workspace new --name <label>
macbox workspace list
macbox workspace show <id>
macbox workspace open <id>
macbox ws  # alias for workspace

# Cleanup
macbox clean --worktree <name>
macbox clean --all
```

### Impact Summary

| Feature                 | Lines Removed | % of 0.7.0 Codebase |
| ----------------------- | ------------- | ------------------- |
| Ralph autonomous loop   | 2,373         | 27%                 |
| Flows system            | 974           | 11%                 |
| Skills system           | 796           | 9%                  |
| Workspaces (simplified) | 462           | 5%                  |
| Presets (simplified)    | 448           | 5%                  |
| Context packs           | 351           | 4%                  |
| Projects registry       | 129           | 1%                  |
| Hooks                   | 39            | <1%                 |
| **Total**               | **5,572**     | **63%**             |

**Net result:**

- Codebase reduced from 8,857 to ~3,287 lines
- Concepts reduced from 12 to 4 (67% reduction)
- Top-level commands reduced from 10+ to 4 (60% reduction)

### What Stays the Same

The core value proposition remains unchanged:

- Run AI agents (Claude, Codex) in macOS Seatbelt sandboxes
- Automatic worktree creation for isolation
- Composable sandbox profiles
- Session persistence
- Capability flags (network, exec, filesystem)
- Trace/debug sandbox violations
- Auto-authentication

### For More Information

See the updated README.md for complete documentation of the simplified
architecture.

For questions about migration, please open an issue on GitHub.

---

## [0.7.0] - 2025-XX-XX

Previous release (pre-simplification). Included Ralph, flows, skills, context
packs, projects, and full workspace lifecycle management.
