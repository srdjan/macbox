import { parseArgs } from "./mini_args.ts";
import { defaultBaseDir } from "./paths.ts";
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
  type SessionRecord,
} from "./sessions.ts";
import { detectRepo, ensureWorktree } from "./git.ts";

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

const defaultShellCmd = () => {
  const sh = Deno.env.get("SHELL") || "/bin/zsh";
  return [sh, "-l"];
};

const loadSessionForAttach = async (
  baseDir: string,
  idRef: string,
): Promise<SessionRecord> => {
  if (idRef === "latest") {
    const s = await findLatestSession({ baseDir });
    if (!s) throw new Error("macbox: no sessions found (latest)");
    return s;
  }
  if (!idRef.includes("/")) {
    throw new Error(
      "macbox attach: session id must be repoId/worktreeName (or 'latest'). Use: macbox sessions list",
    );
  }
  return await loadSessionById({ baseDir, id: idRef });
};

export const attachCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);

  const [idRef, ..._rest] = a._;
  if (!idRef) {
    throw new Error("attach: missing <id>. Use: macbox sessions list");
  }

  const trace = boolFlag(a.flags.trace, false);
  const debug = boolFlag(a.flags.debug, false) || trace;

  const session = await loadSessionForAttach(base, idRef);
  const agent: AgentKind | undefined = session.agent;

  // Repo info (for git dirs; re-detect to be safe)
  const repo = await detectRepo(repoHint ?? session.repoRoot);

  // Ensure worktree exists (in case user cleaned it)
  await ensureWorktree(
    repo.root,
    session.worktreePath,
    `macbox/${session.worktreeName}`,
    "HEAD",
  );

  // Create sandbox dirs
  const mp = `${session.worktreePath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(session.worktreePath);

  const profileFlag = asString(a.flags.profile);
  const agentProfiles = agent ? defaultAgentProfiles(agent) : [];
  const profileNames = [
    ...agentProfiles,
    ...session.profiles,
    ...parseProfileNames(profileFlag),
  ];
  const loadedProfiles = profileNames.length
    ? await loadProfiles(session.worktreePath, profileNames)
    : null;

  const cliExtraRead = parsePathList(a.flags["allow-fs-read"]);
  const cliExtraWrite = parsePathList(a.flags["allow-fs-rw"]);

  // Capabilities: session defaults, overridden by flags if present
  const network =
    a.flags["allow-network"] !== undefined ||
      a.flags["block-network"] !== undefined ||
      a.flags["no-network"] !== undefined
      ? (boolFlag(a.flags["allow-network"], true) &&
        !boolFlag(a.flags["block-network"], false) &&
        !boolFlag(a.flags["no-network"], false))
      : session.caps.network;

  const exec =
    a.flags["allow-exec"] !== undefined || a.flags["block-exec"] !== undefined
      ? (boolFlag(a.flags["allow-exec"], true) &&
        !boolFlag(a.flags["block-exec"], false))
      : session.caps.exec;

  const mergedExtraRead = [
    ...(session.caps.extraRead ?? []),
    ...(loadedProfiles?.extraReadPaths ?? []),
    ...cliExtraRead,
  ];

  const mergedExtraWrite = [
    ...(session.caps.extraWrite ?? []),
    ...(loadedProfiles?.extraWritePaths ?? []),
    ...cliExtraWrite,
  ];

  if (mergedExtraWrite.length) {
    for (const p of mergedExtraWrite) {
      const ok = p.startsWith(session.worktreePath) ||
        p.startsWith(repo.gitCommonDir) || p.startsWith(repo.gitDir);
      if (!ok) {
        console.error(
          `macbox: WARNING: write access outside sandbox worktree: ${p}`,
        );
      }
    }
  }

  const profilePath = `${mp}/profile.sb`;
  await writeSeatbeltProfile(profilePath, {
    worktree: session.worktreePath,
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

  const cmd = a.passthrough.length ? a.passthrough : defaultShellCmd();
  const sx = await detectSandboxExec();
  const env = sandboxEnv(session.worktreePath, agent);
  env["MACBOX_SESSION"] = `${session.worktreeName}-${nowCompact()}`;
  env["MACBOX_SESSION_ID"] = session.id;
  env["MACBOX_WORKTREE"] = session.worktreePath;

  const cmdLine = cmd.join(" ");
  const traceStart = new Date(Date.now() - 1500);

  // Persist updated session metadata
  await saveSession({
    baseDir: base,
    repoRoot: repo.root,
    worktreeName: session.worktreeName,
    worktreePath: session.worktreePath,
    gitCommonDir: repo.gitCommonDir,
    gitDir: repo.gitDir,
    agent,
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

  let code = 1;
  try {
    code = await runSandboxed(sx, {
      profilePath,
      params: {
        WORKTREE: session.worktreePath,
        GIT_COMMON_DIR: repo.gitCommonDir,
        GIT_DIR: repo.gitDir,
      },
      workdir: session.worktreePath,
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
          session: env["MACBOX_SESSION"],
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
