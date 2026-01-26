import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { writeSeatbeltProfile } from "./seatbelt.ts";
import { detectSandboxExec, runSandboxed } from "./sandbox_exec.ts";
import { sandboxEnv } from "./env.ts";
import {
  type AgentKind,
  defaultAgentCmd,
  defaultAgentProfiles,
} from "./agent.ts";
import { formatLogShowTime, nowCompact } from "./os.ts";
import { collectSandboxViolations } from "./sandbox_trace.ts";
import { loadProfiles, parseProfileNames } from "./profiles.ts";
import {
  findLatestSession,
  loadSessionById,
  resolveSessionIdForRepo,
  saveSession,
} from "./sessions.ts";

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

export const runCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const repoHint = asString(a.flags.repo);
  const base = asString(a.flags.base) ?? defaultBaseDir();

  const agentFlagRaw = asString(a.flags.agent) ?? "custom";
  const agentFlag: AgentKind =
    (agentFlagRaw === "claude" || agentFlagRaw === "codex" ||
        agentFlagRaw === "custom")
      ? agentFlagRaw
      : (() => {
        throw new Error(`macbox: unknown --agent: ${agentFlagRaw}`);
      })();
  const agent: AgentKind | undefined = agentFlag === "custom"
    ? undefined
    : agentFlag;
  const cmdOverride = asString(a.flags.cmd);
  const worktreeFlag = asString(a.flags.worktree);
  const sessionRef = asString(a.flags.session);
  const worktreeNameDefault = "ai";
  // Start point for new worktrees. This can be a branch name, tag, or commit SHA.
  const startPoint = asString(a.flags.branch) ?? "HEAD";
  const profileFlag = asString(a.flags.profile);
  const trace = boolFlag(a.flags.trace, false);
  const debug = boolFlag(a.flags.debug, false) || trace;
  const repo = await detectRepo(repoHint);

  // Optional sessions: use saved defaults for this repo/worktree.
  let sessionRec: Awaited<ReturnType<typeof loadSessionById>> | null = null;
  if (sessionRef) {
    const sid = await resolveSessionIdForRepo({
      baseDir: base,
      repoRoot: repo.root,
      ref: sessionRef,
      agent: agentFlag !== "custom" ? agentFlag : undefined,
    });
    sessionRec = await loadSessionById({ baseDir: base, id: sid });
  }

  // Worktree selection: explicit flag wins; otherwise, use latest session (optionally filtered by agent), else default.
  const inferredLatest = !worktreeFlag
    ? await findLatestSession({
      baseDir: base,
      repoRoot: repo.root,
      agent: agentFlag !== "custom" ? agentFlag : undefined,
    })
    : null;

  const worktreeName = worktreeFlag ?? sessionRec?.worktreeName ??
    inferredLatest?.worktreeName ?? worktreeNameDefault;
  const wtPath = await worktreeDir(base, repo.root, worktreeName);

  // Capabilities: session defaults, overridden by flags if present
  const defaultNetwork = sessionRec?.caps.network ?? true;
  const defaultExec = sessionRec?.caps.exec ?? true;
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

  // Create the worktree on a safe, tool-owned branch name (never rewrites user branches).
  const wtBranch = `macbox/${worktreeName}`;
  await ensureWorktree(repo.root, wtPath, wtBranch, startPoint);

  // Create sandbox dirs in worktree
  const mp = `${wtPath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  // Load optional profile snippets (agent implies a bundled profile)
  const agentProfiles = defaultAgentProfiles(agentFlag);
  const profileNames = [
    ...agentProfiles,
    ...(sessionRec?.profiles ?? []),
    ...parseProfileNames(profileFlag),
  ];
  const loadedProfiles = profileNames.length
    ? await loadProfiles(wtPath, profileNames)
    : null;

  const cliExtraRead = parsePathList(a.flags["allow-fs-read"]);
  const cliExtraWrite = parsePathList(a.flags["allow-fs-rw"]);

  const mergedExtraRead = [
    ...((sessionRec?.caps.extraRead ?? []) as ReadonlyArray<string>),
    ...(loadedProfiles?.extraReadPaths ?? []),
    ...cliExtraRead,
  ];
  const mergedExtraWrite = [
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

  // Write seatbelt profile
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

  // Build command
  const baseCmd = cmdOverride ? [cmdOverride] : [...defaultAgentCmd(agentFlag)];
  const passthrough = a.passthrough;

  const fullCmd = baseCmd.length > 0
    ? [...baseCmd, ...passthrough]
    : passthrough;
  if (fullCmd.length === 0) {
    throw new Error(
      "run: no command to execute. Provide --agent or --cmd and/or pass args after `--`.",
    );
  }

  // Detect sandbox-exec and run
  const sx = await detectSandboxExec();

  const env = sandboxEnv(wtPath, agent);
  // Also set a stable session marker for logs/tools
  env["MACBOX_SESSION"] = `${worktreeName}-${nowCompact()}`;
  env["MACBOX_WORKTREE"] = wtPath;

  const session = env["MACBOX_SESSION"];
  const cmdLine = fullCmd.join(" ");
  const traceStart = new Date(Date.now() - 1500);

  // Persist session defaults (per repo/worktree)
  try {
    await saveSession({
      baseDir: base,
      repoRoot: repo.root,
      worktreeName,
      worktreePath: wtPath,
      gitCommonDir: repo.gitCommonDir,
      gitDir: repo.gitDir,
      agent: agentFlag,
      profiles: profileNames,
      caps: {
        network,
        exec,
        extraRead: mergedExtraRead,
        extraWrite: mergedExtraWrite,
      },
      debug,
      trace,
      lastCommand: fullCmd,
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
