// `macbox claude` and `macbox codex` unified command handler.
// Combines start.ts auto-detection + run.ts sandbox execution + auto-auth + --ralph dispatch.

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
import { loadProfilesOptional, parseProfileNames } from "./profiles.ts";
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
  writeAgentConfig,
  writeSkillFiles,
} from "./presets.ts";
import { asString, boolFlag, parsePathList } from "./flags.ts";
import { resolveAgentPath } from "./agent_detect.ts";
import { nextWorktreeName } from "./worktree_naming.ts";
import { loadMacboxConfig } from "./flow_config.ts";
import { findProjectByPath } from "./project.ts";
import { ensureAuthenticated } from "./auto_auth.ts";
import { ralphCmd } from "./ralph_cmd.ts";
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

const pushFlag = (
  argv: string[],
  name: string,
  value: string | boolean | undefined,
) => {
  if (value === undefined) return;
  if (typeof value === "boolean") {
    if (value) argv.push(`--${name}`);
    return;
  }
  argv.push(`--${name}`, value);
};

/** Build argv for ralphCmd from agent_cmd parsed flags. */
const buildRalphArgv = (
  ralphTarget: string,
  agent: AgentKind,
  a: ReturnType<typeof parseArgs>,
): string[] => {
  const argv: string[] = [ralphTarget, "--agent", agent];
  // Forward shared flags
  pushFlag(argv, "preset", asString(a.flags.preset));
  pushFlag(argv, "profile", asString(a.flags.profile));
  pushFlag(argv, "worktree", asString(a.flags.worktree));
  pushFlag(argv, "branch", asString(a.flags.branch));
  pushFlag(argv, "cmd", asString(a.flags.cmd));
  pushFlag(argv, "debug", a.flags.debug);
  pushFlag(argv, "trace", a.flags.trace);
  pushFlag(argv, "json", a.flags.json);
  pushFlag(argv, "repo", asString(a.flags.repo));
  pushFlag(argv, "base", asString(a.flags.base));
  // Forward ralph-specific flags
  pushFlag(argv, "gate", asString(a.flags.gate));
  pushFlag(argv, "max-iterations", asString(a.flags["max-iterations"]));
  pushFlag(argv, "no-commit", a.flags["no-commit"]);
  // Forward passthrough
  if (a.passthrough.length) {
    argv.push("--", ...a.passthrough);
  }
  return argv;
};

export const agentCmd = async (
  agent: AgentKind,
  argv: ReadonlyArray<string>,
): Promise<Exit> => {
  const a = parseArgs(argv);

  // --- Primary flags ---
  const ralphTarget = asString(a.flags.ralph);
  const promptRaw = a.flags.prompt;
  if (promptRaw === true) {
    throw new Error("macbox: --prompt requires a value");
  }
  const prompt = asString(promptRaw);

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

  // --- Resolve preset (CLI > macbox.json > project defaults) ---
  const repo = await detectRepo(repoHint);
  const config = await loadMacboxConfig(repo.root, repo.root);
  const project = await findProjectByPath(repo.root);

  let presetName = asString(a.flags.preset) ??
    config?.defaults?.preset ?? project?.defaultPreset;

  let presetConfig: LoadedPreset | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
  }

  // --- Resolve command override (CLI > preset) ---
  cmdOverride = cmdOverride ?? presetConfig?.preset.cmd;

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

  // --- Resolve agent binary path (from start.ts) ---
  let autoProfile: string | null = null;
  if (!cmdOverride) {
    const resolved = await resolveAgentPath(agent);
    if (!resolved) {
      throw new Error(
        `macbox: '${agent}' not found on PATH. Install it or use --cmd /path/to/${agent}.`,
      );
    }
    // Auto-detect if agent binary is under HOME and add profile
    const home = Deno.env.get("HOME") ?? "";
    if (home && resolved.startsWith(`${home}/`)) {
      autoProfile = agent === "claude" ? "host-claude" : "host-tools";
      cmdOverride = resolved;
      console.log(`macbox: auto-enabled ${autoProfile} profile (agent under HOME)`);
    }
  }

  // --- Auto-authenticate ---
  const exe = cmdOverride ?? agent;
  await ensureAuthenticated(agent, exe);

  // --- Ralph dispatch ---
  if (ralphTarget) {
    return await ralphCmd(buildRalphArgv(ralphTarget, agent, a));
  }

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
      agent,
    });
    sessionRec = await loadSessionById({ baseDir: base, id: sid });
  }

  // --- Worktree naming (from start.ts: auto-increment) ---
  const worktreeFlag = asString(a.flags.worktree);
  const prefix = presetConfig?.preset.worktreePrefix ??
    `ai-${agent}`;

  const inferredLatest = !worktreeFlag
    ? await findLatestSession({ baseDir: base, repoRoot: repo.root, agent })
    : null;

  const worktreeName = worktreeFlag ?? sessionRec?.worktreeName ??
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

  // --- Load profiles ---
  const agentProfiles = defaultAgentProfiles(agent);
  const profileFlag = asString(a.flags.profile);
  const defaultProfiles = [
    ...(config?.defaults?.profiles ?? []),
    ...(project?.defaultProfiles ?? []),
  ];
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
  const baseCmd = cmdOverride ? [cmdOverride] : [...defaultAgentCmd(agent)];
  if (agent === "claude" && cmdOverride) {
    baseCmd.push("-p", "--dangerously-skip-permissions");
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
  const env = sandboxEnv(wtPath, agent);
  env["MACBOX_SESSION"] = `${worktreeName}-${nowCompact()}`;
  env["MACBOX_WORKTREE"] = wtPath;
  if (presetConfig?.preset.env) {
    for (const [k, v] of Object.entries(presetConfig.preset.env)) env[k] = v;
  }
  await augmentPathForHostTools(env, profileNames, Deno.env.get("HOME") ?? "");

  if (presetConfig?.preset.model) {
    await writeAgentConfig(wtPath, agent, presetConfig.preset.model);
  }

  if (presetConfig?.preset.skills?.length) {
    await writeSkillFiles(wtPath, presetConfig.preset.skills);
  }

  // --- Print summary ---
  console.log(`macbox: ${agent}`);
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
      agent,
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
