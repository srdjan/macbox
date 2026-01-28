import { writeSeatbeltProfile } from "./seatbelt.ts";
import {
  detectSandboxExec,
  runSandboxed,
  runSandboxedCapture,
  type SandboxCaptured,
} from "./sandbox_exec.ts";
import { sandboxEnv } from "./env.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { loadProfiles } from "./profiles.ts";
import { expandPath } from "./presets.ts";
import type { AgentKind } from "./agent.ts";
import { defaultAgentProfiles } from "./agent.ts";
import { nowCompact } from "./os.ts";
import type { SessionCaps } from "./sessions.ts";

export type SandboxRunRequest = {
  readonly worktreePath: string;
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent?: AgentKind;
  readonly profiles?: ReadonlyArray<string>;
  readonly caps?: Partial<SessionCaps>;
  readonly command: ReadonlyArray<string>;
  readonly env?: Record<string, string>;
  readonly debug?: boolean;
  readonly capture?: boolean;
};

export type SandboxRunResult = {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

export const executeSandboxRun = async (
  req: SandboxRunRequest,
): Promise<SandboxRunResult> => {
  const wtPath = req.worktreePath;
  const mp = `${wtPath}/.macbox`;

  // Ensure sandbox dirs exist
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  // Load profiles
  const agentProfiles = req.agent ? defaultAgentProfiles(req.agent) : [];
  const profileNames = [...agentProfiles, ...(req.profiles ?? [])];
  const loadedProfiles = profileNames.length
    ? await loadProfiles(wtPath, profileNames)
    : null;

  // Merge capabilities
  const network = req.caps?.network ?? true;
  const exec = req.caps?.exec ?? true;
  const extraRead = [
    ...((req.caps?.extraRead ?? []) as ReadonlyArray<string>),
    ...(loadedProfiles?.extraReadPaths ?? []),
  ];
  const extraWrite = [
    ...((req.caps?.extraWrite ?? []) as ReadonlyArray<string>),
    ...(loadedProfiles?.extraWritePaths ?? []),
  ];

  // Write seatbelt profile
  const profilePath = `${mp}/profile.sb`;
  await writeSeatbeltProfile(profilePath, {
    worktree: wtPath,
    gitCommonDir: req.gitCommonDir,
    gitDir: req.gitDir,
    debug: req.debug ?? false,
    network,
    exec,
    allowMachLookupAll: loadedProfiles?.allowMachLookupAll,
    machServices: loadedProfiles?.machServices,
    extraReadPaths: extraRead.length ? extraRead : undefined,
    extraWritePaths: extraWrite.length ? extraWrite : undefined,
  });

  // Build environment
  const env = sandboxEnv(wtPath, req.agent);
  env["MACBOX_SESSION"] = `sandbox-${nowCompact()}`;
  env["MACBOX_WORKTREE"] = wtPath;

  // Inject extra environment
  if (req.env) {
    for (const [k, v] of Object.entries(req.env)) {
      env[k] = v;
    }
  }

  const sx = await detectSandboxExec();
  const params = {
    WORKTREE: wtPath,
    GIT_COMMON_DIR: req.gitCommonDir,
    GIT_DIR: req.gitDir,
  };

  if (req.capture) {
    const result: SandboxCaptured = await runSandboxedCapture(sx, {
      profilePath,
      params,
      workdir: wtPath,
      env,
      command: [...req.command],
    });
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const code = await runSandboxed(sx, {
    profilePath,
    params,
    workdir: wtPath,
    env,
    command: [...req.command],
  });

  return { code };
};
