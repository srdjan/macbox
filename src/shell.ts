import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { writeSeatbeltProfile } from "./seatbelt.ts";
import { detectSandboxExec, runSandboxed } from "./sandbox_exec.ts";
import { sandboxEnv } from "./env.ts";
import { type AgentKind, defaultAgentProfiles } from "./agent.ts";
import { formatLogShowTime, nowCompact } from "./os.ts";
import { collectSandboxViolations } from "./sandbox_trace.ts";
import { loadProfiles, parseProfileNames } from "./profiles.ts";
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
} from "./presets.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined
    ? undefined
    : typeof v === "string"
    ? v
    : v
    ? "true"
    : "false";

const boolFlag = (v: string | boolean | undefined, dflt: boolean): boolean => {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  return v === "true" || v === "1" || v === "yes";
};

const parsePathList = (
  v: string | boolean | undefined,
): ReadonlyArray<string> => {
  if (v === undefined) return [];
  const s = typeof v === "string" ? v : v ? "true" : "";
  if (!s || s === "true") return [];
  return s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
};

export const shellCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const repoHint = asString(a.flags.repo);
  const base = asString(a.flags.base) ?? defaultBaseDir();

  // Load preset if specified
  const presetName = asString(a.flags.preset);
  let presetConfig: LoadedPreset | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
  }

  // Agent selection: CLI flag > preset > undefined
  const agentFlagRaw = asString(a.flags.agent) ?? presetConfig?.preset.agent;
  const agent: AgentKind | undefined =
    agentFlagRaw &&
      (agentFlagRaw === "claude" || agentFlagRaw === "codex" ||
        agentFlagRaw === "custom")
      ? agentFlagRaw
      : agentFlagRaw
      ? (() => {
        throw new Error(`macbox: unknown --agent: ${agentFlagRaw}`);
      })()
      : undefined;

  const worktreeFlag = asString(a.flags.worktree);
  const sessionRef = asString(a.flags.session);

  // Start point for new worktrees: CLI flag > preset > default
  const startPoint = asString(a.flags.branch) ?? presetConfig?.preset.startPoint ?? "HEAD";

  const profileFlag = asString(a.flags.profile);
  const trace = boolFlag(a.flags.trace, false);
  const debug = boolFlag(a.flags.debug, false) || trace;
  const repo = await detectRepo(repoHint);

  // Validate preset paths and warn if any don't exist
  if (presetConfig) {
    const warnings = await validatePresetPaths(presetConfig.preset);
    for (const w of warnings) {
      console.error(`macbox: WARNING: ${w}`);
    }
  }

  // Optional sessions: use saved defaults for this repo/worktree.
  let sessionRec: Awaited<ReturnType<typeof loadSessionById>> | null = null;
  if (sessionRef) {
    const sid = await resolveSessionIdForRepo({
      baseDir: base,
      repoRoot: repo.root,
      ref: sessionRef,
      agent: agent && agent !== "custom" ? agent : undefined,
    });
    sessionRec = await loadSessionById({ baseDir: base, id: sid });
  }

  const inferredLatest = !worktreeFlag
    ? await findLatestSession({
      baseDir: base,
      repoRoot: repo.root,
      agent: agent && agent !== "custom" ? agent : undefined,
    })
    : null;

  const worktreeNameDefault = presetConfig?.preset.worktreePrefix
    ? `${presetConfig.preset.worktreePrefix}-ai`
    : (agent && agent !== "custom" ? `ai-${agent}` : "ai");
  const worktreeName = worktreeFlag ?? sessionRec?.worktreeName ??
    inferredLatest?.worktreeName ?? worktreeNameDefault;
  const wtPath = await worktreeDir(base, repo.root, worktreeName);

  // Capabilities: session defaults, overridden by preset, overridden by flags
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

  // Ensure worktree exists (if missing, create on a safe, tool-owned branch)
  await ensureWorktree(repo.root, wtPath, `macbox/${worktreeName}`, startPoint);

  // Create sandbox dirs
  const mp = `${wtPath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  // Load optional profile snippets (agent implies a bundled profile)
  const agentProfiles = agent ? defaultAgentProfiles(agent) : [];
  const profileNames = [
    ...agentProfiles,
    ...(presetConfig?.preset.profiles ?? []),
    ...(sessionRec?.profiles ?? []),
    ...parseProfileNames(profileFlag),
  ];
  const loadedProfiles = profileNames.length
    ? await loadProfiles(wtPath, profileNames)
    : null;

  const cliExtraRead = parsePathList(a.flags["allow-fs-read"]);
  const cliExtraWrite = parsePathList(a.flags["allow-fs-rw"]);

  // Merge extra paths: preset > session > profiles > CLI
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

  // Warn if any profile grants write access outside the worktree/git dirs
  if (mergedExtraWrite.length) {
    for (const p of mergedExtraWrite) {
      const ok = p.startsWith(wtPath) || p.startsWith(repo.gitCommonDir) ||
        p.startsWith(repo.gitDir);
      if (!ok) {
        console.error(
          `macbox: WARNING: profile grants write access outside sandbox worktree: ${p}`,
        );
      }
    }
  }

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

  const defaultShell = Deno.env.get("SHELL") || "/bin/zsh";
  const cmd = a.passthrough.length ? a.passthrough : [defaultShell, "-l"];
  const sx = await detectSandboxExec();
  const env = sandboxEnv(wtPath, agent);
  env["MACBOX_SESSION"] = `${worktreeName}-${nowCompact()}`;
  env["MACBOX_WORKTREE"] = wtPath;

  // Inject preset environment variables
  if (presetConfig?.preset.env) {
    for (const [k, v] of Object.entries(presetConfig.preset.env)) {
      env[k] = v;
    }
  }

  // Write agent config for model selection
  if (presetConfig?.preset.model && agent && agent !== "custom") {
    await writeAgentConfig(wtPath, agent, presetConfig.preset.model);
  }

  const sessionId = env["MACBOX_SESSION"];
  const cmdLine = cmd.join(" ");
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
      caps: {
        network,
        exec,
        extraRead: mergedExtraRead,
        extraWrite: mergedExtraWrite,
      },
      debug,
      trace,
      lastCommand: cmd,
      lastCommandLine: cmdLine,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`macbox: failed to save session: ${msg}`);
  }

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
      command: cmd,
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
          session: sessionId,
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
