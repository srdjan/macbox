// `macbox ralph` command - autonomous agent loop driven by a PRD.

import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { writeSeatbeltProfile } from "./seatbelt.ts";
import { sandboxEnv } from "./env.ts";
import { augmentPathForHostTools } from "./host_tools_path.ts";
import { type AgentKind, defaultAgentProfiles } from "./agent.ts";
import { nowCompact } from "./os.ts";
import { loadProfilesOptional, parseProfileNames } from "./profiles.ts";
import { saveSession } from "./sessions.ts";
import { expandPath, loadPreset, type LoadedPreset, validatePresetPaths, writeAgentConfig } from "./presets.ts";
import { asString, boolFlag, parsePathList } from "./flags.ts";
import { detectAgents, pickDefaultAgent, resolveAgentPath } from "./agent_detect.ts";
import { nextWorktreeName } from "./worktree_naming.ts";
import { loadMacboxConfig } from "./flow_config.ts";
import { findProjectByPath } from "./project.ts";
import { runRalphLoop, loadPrdFromFile, promptToPrd, parseRalphConfig } from "./ralph.ts";
import type { Prd, QualityGate, RalphConfig } from "./ralph_types.ts";
import { defaultRalphConfig } from "./ralph_types.ts";
import { collectSandboxViolations } from "./sandbox_trace.ts";
import { formatLogShowTime } from "./os.ts";
import { pathJoin } from "./os.ts";
import type { Exit } from "./main.ts";

const isAgent = (v: string): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

/** Parse --gate "name:cmd" flags into QualityGate array. */
const parseGateFlags = (raw: string | boolean | undefined): QualityGate[] => {
  if (!raw || typeof raw !== "string") return [];
  // Support comma-separated or single gate
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const colon = entry.indexOf(":");
    if (colon < 0) throw new Error(`ralph: --gate must be "name:cmd", got: ${entry}`);
    return { name: entry.slice(0, colon).trim(), cmd: entry.slice(colon + 1).trim() };
  });
};

export const ralphCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const debug = boolFlag(a.flags.debug, false) || boolFlag(a.flags.trace, false);
  const trace = boolFlag(a.flags.trace, false);
  const jsonOut = boolFlag(a.flags.json, false);

  // Positional argument: prompt text or path to prd.json
  const positional = a._[0];
  if (!positional) {
    throw new Error("ralph: requires a prompt string or path to prd.json");
  }

  // Load preset
  const presetName = asString(a.flags.preset);
  let presetConfig: LoadedPreset | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
  }

  // Detect repo
  const repo = await detectRepo(repoHint);
  const config = await loadMacboxConfig(repo.root, repo.root);
  const project = await findProjectByPath(repo.root);

  // Resolve agent: CLI > preset > macbox.json defaults > project > auto-detect
  const agentRaw = asString(a.flags.agent) ?? presetConfig?.preset.agent ??
    config?.defaults?.agent ?? project?.defaultAgent;
  let agent: AgentKind | undefined = agentRaw && isAgent(agentRaw) ? agentRaw : undefined;

  const cmdOverride = asString(a.flags.cmd) ?? presetConfig?.preset.cmd;

  if (!agent && !cmdOverride) {
    const detected = await detectAgents();
    const picked = pickDefaultAgent(detected);
    agent = picked.agent;
  }

  if (!agent && !cmdOverride) {
    throw new Error(
      "ralph: no agent detected. Install 'claude' or 'codex', or use --agent/--preset/--cmd.",
    );
  }

  const agentFlag: AgentKind = agent ?? "custom";
  const baseCmd = cmdOverride ? [cmdOverride] : undefined;
  if (baseCmd && agentFlag === "claude") {
    baseCmd.push("-p", "--dangerously-skip-permissions");
  }

  // Validate preset paths
  if (presetConfig) {
    const warnings = await validatePresetPaths(presetConfig.preset);
    for (const w of warnings) console.error(`macbox: WARNING: ${w}`);
  }

  // Resolve worktree
  const worktreeFlag = asString(a.flags.worktree);
  const prefix = presetConfig?.preset.worktreePrefix ??
    (agent && agent !== "custom" ? `ralph-${agent}` : "ralph");
  const worktreeName = worktreeFlag ?? await nextWorktreeName({ baseDir: base, repoRoot: repo.root, prefix });
  const wtPath = await worktreeDir(base, repo.root, worktreeName);
  const startPoint = asString(a.flags.branch) ?? presetConfig?.preset.startPoint ?? "HEAD";
  const wtBranch = `macbox/${worktreeName}`;
  await ensureWorktree(repo.root, wtPath, wtBranch, startPoint);

  // Create sandbox dirs
  const mp = `${wtPath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  // Load profiles
  const agentProfiles = defaultAgentProfiles(agentFlag);
  const profileFlag = asString(a.flags.profile);
  const defaultProfiles = [
    ...(config?.defaults?.profiles ?? []),
    ...(project?.defaultProfiles ?? []),
  ];
  const profileNames = [
    ...agentProfiles,
    ...(presetConfig?.preset.profiles ?? []),
    ...defaultProfiles,
    ...parseProfileNames(profileFlag),
  ];
  const optionalProfiles = new Set(agentProfiles);
  const loadedProfiles = profileNames.length
    ? await loadProfilesOptional(wtPath, profileNames, optionalProfiles)
    : null;
  if (loadedProfiles?.warnings?.length) {
    for (const w of loadedProfiles.warnings) console.error(`macbox: WARNING: ${w}`);
  }

  // Merge extra paths
  const cliExtraRead = parsePathList(a.flags["allow-fs-read"]);
  const cliExtraWrite = parsePathList(a.flags["allow-fs-rw"]);
  const presetExtraRead = (presetConfig?.preset.capabilities?.extraReadPaths ?? []).map(expandPath);
  const presetExtraWrite = (presetConfig?.preset.capabilities?.extraWritePaths ?? []).map(expandPath);
  const mergedExtraRead = [...presetExtraRead, ...(loadedProfiles?.extraReadPaths ?? []), ...cliExtraRead];
  const mergedExtraWrite = [...presetExtraWrite, ...(loadedProfiles?.extraWritePaths ?? []), ...cliExtraWrite];

  // Capabilities
  const network = a.flags["block-network"] !== undefined || a.flags["no-network"] !== undefined
    ? false
    : (presetConfig?.preset.capabilities?.network ?? true);
  const execCap = a.flags["block-exec"] !== undefined
    ? false
    : (presetConfig?.preset.capabilities?.exec ?? true);

  // Write seatbelt profile
  const profilePath = `${mp}/profile.sb`;
  await writeSeatbeltProfile(profilePath, {
    worktree: wtPath,
    gitCommonDir: repo.gitCommonDir,
    gitDir: repo.gitDir,
    debug,
    network,
    exec: execCap,
    allowMachLookupAll: loadedProfiles?.allowMachLookupAll,
    machServices: loadedProfiles?.machServices,
    extraReadPaths: mergedExtraRead.length ? mergedExtraRead : undefined,
    extraWritePaths: mergedExtraWrite.length ? mergedExtraWrite : undefined,
  });

  // Build environment
  const env = sandboxEnv(wtPath, agent);
  env["MACBOX_SESSION"] = `${worktreeName}-${nowCompact()}`;
  env["MACBOX_WORKTREE"] = wtPath;
  if (presetConfig?.preset.env) {
    for (const [k, v] of Object.entries(presetConfig.preset.env)) env[k] = v;
  }
  await augmentPathForHostTools(env, profileNames, Deno.env.get("HOME") ?? "");

  // Write agent config for model selection
  if (presetConfig?.preset.model && agentFlag !== "custom") {
    await writeAgentConfig(wtPath, agentFlag, presetConfig.preset.model);
  }

  // Load or generate PRD
  const isJsonInput = positional.endsWith(".json");
  let prd: Prd;
  let prdPath: string | undefined;
  if (isJsonInput) {
    const wtCandidate = pathJoin(wtPath, positional);
    const absCandidate = positional.startsWith("/")
      ? positional
      : pathJoin(Deno.cwd(), positional);
    let sourcePath: string | undefined;
    if (await pathExists(wtCandidate)) {
      sourcePath = wtCandidate;
    } else if (await pathExists(absCandidate)) {
      sourcePath = absCandidate;
    }
    if (sourcePath) {
      prd = await loadPrdFromFile(sourcePath);
      const wtPrefix = wtPath.endsWith("/") ? wtPath : `${wtPath}/`;
      if (sourcePath === wtPath || sourcePath.startsWith(wtPrefix)) {
        prdPath = sourcePath;
      } else {
        prdPath = pathJoin(wtPath, "prd.json");
        await Deno.writeTextFile(prdPath, JSON.stringify(prd, null, 2) + "\n", { create: true });
      }
    } else {
      prd = promptToPrd(positional);
    }
  } else {
    prd = promptToPrd(positional);
  }

  // Build Ralph config: preset ralph section + CLI flags
  const presetRalph = presetConfig?.preset.ralph;
  const baseConfig = parseRalphConfig(presetRalph);

  const maxIterationsFlag = asString(a.flags["max-iterations"]);
  const maxIterations = maxIterationsFlag ? parseInt(maxIterationsFlag, 10) : baseConfig.maxIterations;
  const commitOnPass = a.flags["no-commit"] !== undefined ? false : baseConfig.commitOnPass;

  // Merge quality gates: preset + CLI --gate flags
  const cliGates = parseGateFlags(a.flags.gate as string | boolean | undefined);
  const qualityGates = [...baseConfig.qualityGates, ...cliGates];

  const ralphConfig: RalphConfig = {
    maxIterations: maxIterations > 0 ? maxIterations : defaultRalphConfig.maxIterations,
    qualityGates,
    delayBetweenIterationsMs: baseConfig.delayBetweenIterationsMs,
    commitOnPass,
    promptTemplate: baseConfig.promptTemplate,
  };

  // Print summary
  console.log("macbox: ralph");
  if (agent) console.log(`  agent:          ${agent}`);
  if (presetName) console.log(`  preset:         ${presetName}`);
  console.log(`  worktree:       ${worktreeName}`);
  console.log(`  max-iterations: ${ralphConfig.maxIterations}`);
  console.log(`  stories:        ${prd.userStories.length}`);
  if (ralphConfig.qualityGates.length > 0) {
    console.log(`  gates:          ${ralphConfig.qualityGates.map((g) => g.name).join(", ")}`);
  }

  // Save session
  const session = env["MACBOX_SESSION"];
  const traceStart = new Date(Date.now() - 1500);

  try {
    await saveSession({
      baseDir: base,
      repoRoot: repo.root,
      worktreeName,
      worktreePath: wtPath,
      gitCommonDir: repo.gitCommonDir,
      gitDir: repo.gitDir,
      agent: agentFlag,
      preset: presetConfig?.preset.name,
      presetSource: presetConfig?.source,
      profiles: profileNames,
      caps: { network, exec: execCap, extraRead: mergedExtraRead, extraWrite: mergedExtraWrite },
      debug,
      trace,
      lastCommand: ["ralph", positional],
      lastCommandLine: `ralph ${positional}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`macbox: failed to save session: ${msg}`);
  }

  // Run the Ralph loop
  let state;
  try {
    state = await runRalphLoop({
      prd,
      prdPath,
      config: ralphConfig,
      worktreePath: wtPath,
      repoRoot: repo.root,
      gitCommonDir: repo.gitCommonDir,
      gitDir: repo.gitDir,
      agent: agentFlag,
      command: baseCmd,
      profiles: profileNames,
      caps: { network, exec: execCap, extraRead: mergedExtraRead, extraWrite: mergedExtraWrite },
      env,
      debug,
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
          commandLine: `ralph ${positional}`,
        });
        console.error(`macbox: wrote sandbox violations to: ${outFile}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`macbox: failed to collect sandbox violations: ${msg}`);
      }
    }
  }

  // Output
  if (jsonOut) {
    console.log(JSON.stringify(state, null, 2));
  }

  return { code: state.allStoriesPassed ? 0 : 1 };
};
