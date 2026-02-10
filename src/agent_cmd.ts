// Agent command handler.
// Resolves agent from preset/config/auto-detect, then runs in sandbox.
// Requires --prompt.

import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { writeSeatbeltProfile } from "./seatbelt.ts";
import { detectSandboxExec, runSandboxed } from "./sandbox_exec.ts";
import { sandboxEnv } from "./env.ts";
import { augmentPathForHostTools } from "./host_tools_path.ts";
import {
  type AgentKind,
  defaultAgentCmd,
  defaultAgentProfiles,
} from "./agent.ts";
import { formatLogShowTime, nowCompact } from "./os.ts";
import { collectSandboxViolations } from "./sandbox_trace.ts";
import { loadProfilesOptional } from "./profiles.ts";
import {
  findLatestSession,
  loadSessionById,
  resolveSessionIdForRepo,
  saveSession,
} from "./sessions.ts";
import {
  expandPath,
  loadPreset,
  type LoadedPreset,
  validatePresetPaths,
} from "./presets.ts";
import { asString, boolFlag, parseEnvPairs, parsePathList } from "./flags.ts";
import { detectAgents, pickDefaultAgent, resolveAgentPath } from "./agent_detect.ts";
import { nextWorktreeName } from "./worktree_naming.ts";
import { loadMacboxConfig } from "./config.ts";
import { ensureAuthenticated } from "./auto_auth.ts";
import { validateWorktreeName, validateWorktreePrefix } from "./validate.ts";
import type { Exit } from "./main.ts";

const mergeProfiles = (
  defaults: ReadonlyArray<string>,
  extra: string | undefined,
): string[] => {
  const set = new Set<string>();
  for (const p of defaults) if (p.trim()) set.add(p.trim());
  if (extra) {
    for (const p of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      set.add(p);
    }
  }
  return [...set.values()];
};

const isAgent = (v: string): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

export const agentCmd = async (
  argv: ReadonlyArray<string>,
): Promise<Exit> => {
  const a = parseArgs(argv);

  // --- Primary flags ---
  const promptRaw = a.flags.prompt;
  if (promptRaw === true) {
    throw new Error("macbox: --prompt requires a value");
  }
  const prompt = asString(promptRaw);

  // --- Require --prompt ---
  if (!prompt) {
    throw new Error(
      "macbox: --prompt is required.\n" +
      '  macbox --prompt "fix the build"',
    );
  }

  // --- Hidden flags ---
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const cmdFlagRaw = a.flags.cmd;
  if (cmdFlagRaw === true) {
    throw new Error("macbox: --cmd requires a value (e.g., --cmd /path/to/agent)");
  }
  let cmdOverride = asString(cmdFlagRaw);
  const trace = boolFlag(a.flags.trace, false);
  const debug = boolFlag(a.flags.debug, false) || trace;
  const disableHostClaudeProfile = boolFlag(a.flags["no-host-claude-profile"], false);

  // --- Resolve preset (CLI > macbox.json) ---
  const repo = await detectRepo(repoHint);
  const config = await loadMacboxConfig(repo.root, repo.root);

  const presetName = asString(a.flags.preset) ??
    config?.defaults?.preset;

  let presetConfig: LoadedPreset | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
  }

  // --- Resolve command override (CLI) ---
  if (cmdOverride) {
    const looksLikePath = cmdOverride.includes("/") || cmdOverride.startsWith(".");
    if (looksLikePath) {
      try {
        await Deno.stat(cmdOverride);
      } catch {
        throw new Error(`macbox: --cmd path not found: ${cmdOverride}`);
      }
    }
  }

  // --- Resolve agent: preset > macbox.json defaults > auto-detect ---
  const agentRaw = presetConfig?.preset.agent ??
    config?.defaults?.agent;
  let agent: AgentKind | undefined = agentRaw && isAgent(agentRaw) ? agentRaw : undefined;

  if (!agent && !cmdOverride) {
    const detected = await detectAgents();
    const picked = pickDefaultAgent(detected);
    agent = picked.agent;
  }

  if (!agent && !cmdOverride) {
    throw new Error(
      "macbox: no agent detected. Install 'claude' or 'codex', or configure via preset/macbox.json.",
    );
  }

  const effectiveAgent: AgentKind = agent ?? "custom";

  // --- Resolve agent binary path ---
  let autoProfile: string | null = null;
  if (!cmdOverride) {
    const resolved = await resolveAgentPath(effectiveAgent);
    if (!resolved) {
      throw new Error(
        `macbox: '${effectiveAgent}' not found on PATH. Install it or use --cmd /path/to/${effectiveAgent}.`,
      );
    }
    // Auto-detect if agent binary is under HOME and add profile
    const home = Deno.env.get("HOME") ?? "";
    if (home && resolved.startsWith(`${home}/`)) {
      autoProfile = effectiveAgent === "claude" ? "host-claude" : "host-tools";
      cmdOverride = resolved;
      if (autoProfile === "host-claude" && disableHostClaudeProfile) {
        autoProfile = null;
      } else if (autoProfile === "host-claude") {
        console.error(
          "macbox: WARNING: auto-enabled host-claude profile (grants ~/.claude read/write). " +
            "Use --no-host-claude-profile to disable.",
        );
      } else {
        console.log(`macbox: auto-enabled ${autoProfile} profile (agent under HOME)`);
      }
    } else if (effectiveAgent === "claude") {
      // Always enable host-claude for Claude regardless of install location
      // since Claude needs ~/.claude access for session management
      if (!disableHostClaudeProfile) {
        autoProfile = "host-claude";
        console.error(
          "macbox: WARNING: auto-enabled host-claude profile (grants ~/.claude read/write). " +
            "Use --no-host-claude-profile to disable.",
        );
      }
    }
  }

  // --- Auto-authenticate ---
  const exe = cmdOverride ?? effectiveAgent;
  await ensureAuthenticated(effectiveAgent, exe);

  // --- Validate preset paths ---
  if (presetConfig) {
    const warnings = await validatePresetPaths(presetConfig.preset);
    for (const w of warnings) console.error(`macbox: WARNING: ${w}`);
  }

  // --- Session lookup (hidden --session flag) ---
  const sessionRef = asString(a.flags.session);
  let sessionRec: Awaited<ReturnType<typeof loadSessionById>> | null = null;
  if (sessionRef) {
    const sid = await resolveSessionIdForRepo({
      baseDir: base,
      repoRoot: repo.root,
      ref: sessionRef,
      agent: effectiveAgent,
    });
    sessionRec = await loadSessionById({ baseDir: base, id: sid });
  }

  // --- Worktree naming (from start.ts: auto-increment) ---
  const worktreeFlag = asString(a.flags.worktree);
  const safeWorktreeFlag = worktreeFlag ? validateWorktreeName(worktreeFlag) : undefined;
  const prefix = validateWorktreePrefix(presetConfig?.preset.worktreePrefix ??
    `ai-${effectiveAgent}`);

  const inferredLatest = !worktreeFlag
    ? await findLatestSession({ baseDir: base, repoRoot: repo.root, agent: effectiveAgent })
    : null;

  const worktreeName = safeWorktreeFlag ?? sessionRec?.worktreeName ??
    inferredLatest?.worktreeName ??
    await nextWorktreeName({ baseDir: base, repoRoot: repo.root, prefix });

  const wtPath = await worktreeDir(base, repo.root, worktreeName);

  // --- Capabilities ---
  const startPoint = asString(a.flags.branch) ?? presetConfig?.preset.startPoint ?? "HEAD";
  const defaultNetwork = sessionRec?.caps.network ?? presetConfig?.preset.capabilities?.network ?? true;
  const defaultExec = sessionRec?.caps.exec ?? presetConfig?.preset.capabilities?.exec ?? true;
  const network =
    (a.flags["allow-network"] !== undefined ||
      a.flags["block-network"] !== undefined ||
      a.flags["no-network"] !== undefined)
      ? (boolFlag(a.flags["allow-network"], true) &&
        !boolFlag(a.flags["block-network"], false) &&
        !boolFlag(a.flags["no-network"], false))
      : defaultNetwork;
  const exec =
    (a.flags["allow-exec"] !== undefined || a.flags["block-exec"] !== undefined)
      ? (boolFlag(a.flags["allow-exec"], true) &&
        !boolFlag(a.flags["block-exec"], false))
      : defaultExec;

  // --- Create worktree ---
  const wtBranch = `macbox/${worktreeName}`;
  await ensureWorktree(repo.root, wtPath, wtBranch, startPoint);

  const mp = `${wtPath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  // Symlink host ~/.claude into sandbox home so Claude CLI can find session auth
  const hostHome = Deno.env.get("HOME") ?? "";
  const hostClaudeDir = `${hostHome}/.claude`;
  const sandboxClaudeLink = `${mp}/home/.claude`;
  try {
    await Deno.stat(hostClaudeDir);
    try {
      await Deno.remove(sandboxClaudeLink, { recursive: true });
    } catch {
      // Link doesn't exist yet, that's fine
    }
    await Deno.symlink(hostClaudeDir, sandboxClaudeLink);
  } catch {
    // Host .claude doesn't exist, skip symlinking
  }

  // --- Load profiles ---
  const agentProfiles = defaultAgentProfiles(effectiveAgent);
  const profileFlag = asString(a.flags.profile);
  const defaultProfiles = config?.defaults?.profiles ?? [];
  const profileNames = mergeProfiles(
    [
      ...agentProfiles,
      ...(presetConfig?.preset.profiles ?? []),
      ...defaultProfiles,
      ...(sessionRec?.profiles ?? []),
      ...(autoProfile ? [autoProfile] : []),
    ],
    profileFlag,
  );
  const optionalProfiles = new Set(agentProfiles);
  const loadedProfiles = profileNames.length
    ? await loadProfilesOptional(wtPath, profileNames, optionalProfiles)
    : null;
  if (loadedProfiles?.warnings?.length) {
    for (const w of loadedProfiles.warnings) console.error(`macbox: WARNING: ${w}`);
  }

  // --- Merge extra paths ---
  const cliExtraRead = parsePathList(a.flags["allow-fs-read"]);
  const cliExtraWrite = parsePathList(a.flags["allow-fs-rw"]);
  const presetExtraRead = (presetConfig?.preset.capabilities?.extraReadPaths ?? []).map(expandPath);
  const presetExtraWrite = (presetConfig?.preset.capabilities?.extraWritePaths ?? []).map(expandPath);
  const mergedExtraRead = [
    ...presetExtraRead,
    ...((sessionRec?.caps.extraRead ?? []) as ReadonlyArray<string>),
    ...(loadedProfiles?.extraReadPaths ?? []),
    ...cliExtraRead,
  ];
  const mergedExtraWrite = [
    ...presetExtraWrite,
    ...((sessionRec?.caps.extraWrite ?? []) as ReadonlyArray<string>),
    ...(loadedProfiles?.extraWritePaths ?? []),
    ...cliExtraWrite,
  ];

  if (mergedExtraWrite.length) {
    for (const p of mergedExtraWrite) {
      const ok = p.startsWith(wtPath) || p.startsWith(repo.gitCommonDir) ||
        p.startsWith(repo.gitDir);
      if (!ok) {
        console.error(`macbox: WARNING: profile grants write access outside sandbox worktree: ${p}`);
      }
    }
  }

  // --- Write seatbelt profile ---
  const profilePath = `${mp}/profile.sb`;
  await writeSeatbeltProfile(profilePath, {
    worktree: wtPath,
    gitCommonDir: repo.gitCommonDir,
    gitDir: repo.gitDir,
    debug,
    network,
    exec,
    allowMachLookupAll: loadedProfiles?.allowMachLookupAll,
    machServices: loadedProfiles?.machServices,
    extraReadPaths: mergedExtraRead.length ? mergedExtraRead : undefined,
    extraWritePaths: mergedExtraWrite.length ? mergedExtraWrite : undefined,
  });

  // --- Build command ---
  // At this point, --prompt is guaranteed (required above).
  const baseCmd = cmdOverride ? [cmdOverride] : [...defaultAgentCmd(effectiveAgent, true)];
  if (effectiveAgent === "claude" && cmdOverride) {
    baseCmd.push("-p", "--allow-dangerously-skip-permissions", "--dangerously-skip-permissions");
  }
  const passthrough = a.passthrough;
  const fullCmd = baseCmd.length > 0
    ? [...baseCmd, ...passthrough]
    : [...passthrough];
  if (prompt) {
    fullCmd.push(prompt);
  }
  if (fullCmd.length === 0) {
    throw new Error("macbox: no command to execute.");
  }

  // --- Sandbox env ---
  const sx = await detectSandboxExec();
  const env = sandboxEnv(wtPath, effectiveAgent);
  env["MACBOX_SESSION"] = `${worktreeName}-${nowCompact()}`;
  env["MACBOX_WORKTREE"] = wtPath;
  if (presetConfig?.preset.env) {
    for (const [k, v] of Object.entries(presetConfig.preset.env)) env[k] = v;
  }
  const cliEnv = parseEnvPairs(a.flags.env as string | boolean | undefined);
  for (const [k, v] of Object.entries(cliEnv)) env[k] = v;
  await augmentPathForHostTools(env, profileNames, Deno.env.get("HOME") ?? "");

  // --- Print summary ---
  console.log(`macbox: ${effectiveAgent}`);
  if (presetName) console.log(`  preset:   ${presetName}`);
  console.log(`  worktree: ${worktreeName}`);

  // --- Save session ---
  const session = env["MACBOX_SESSION"];
  const cmdLine = fullCmd.join(" ");
  const traceStart = new Date(Date.now() - 1500);

  try {
    await saveSession({
      baseDir: base,
      repoRoot: repo.root,
      worktreeName,
      worktreePath: wtPath,
      gitCommonDir: repo.gitCommonDir,
      gitDir: repo.gitDir,
      agent: effectiveAgent,
      preset: presetConfig?.preset.name,
      presetSource: presetConfig?.source,
      profiles: profileNames,
      caps: { network, exec, extraRead: mergedExtraRead, extraWrite: mergedExtraWrite },
      debug,
      trace,
      lastCommand: fullCmd,
      lastCommandLine: cmdLine,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`macbox: failed to save session: ${msg}`);
  }

  // --- Execute ---
  let code = 1;
  try {
    code = await runSandboxed(sx, {
      profilePath,
      params: {
        WORKTREE: wtPath,
        GIT_COMMON_DIR: repo.gitCommonDir,
        GIT_DIR: repo.gitDir,
      },
      workdir: wtPath,
      env,
      command: fullCmd,
    });
  } finally {
    if (trace) {
      const traceEnd = new Date(Date.now() + 250);
      const outFile = `${mp}/logs/sandbox-violations.log`;
      try {
        await collectSandboxViolations({
          outFile,
          start: formatLogShowTime(traceStart),
          end: formatLogShowTime(traceEnd),
          session,
          commandLine: cmdLine,
        });
        console.error(`macbox: wrote sandbox violations to: ${outFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`macbox: failed to collect sandbox violations: ${msg}`);
      }
    }
  }

  return { code };
};
