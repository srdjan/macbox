import { parseArgs } from "./mini_args.ts";
import { runCmd } from "./run.ts";
import { detectRepo } from "./git.ts";
import { defaultBaseDir } from "./paths.ts";
import { loadMacboxConfig } from "./flow_config.ts";
import { findProjectByPath } from "./project.ts";
import { loadPreset } from "./presets.ts";
import { detectAgents, pickDefaultAgent, resolveAgentPath } from "./agent_detect.ts";
import { nextWorktreeName } from "./worktree_naming.ts";
import type { AgentKind } from "./agent.ts";

const asString = (v: string | boolean | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === "string" ? v : v ? "true" : "false";

const isAgent = (v: string): v is AgentKind =>
  v === "claude" || v === "codex" || v === "custom";

const mergeProfiles = (
  defaults: ReadonlyArray<string>,
  extra: string | undefined,
): string | undefined => {
  const set = new Set<string>();
  for (const p of defaults) if (p.trim()) set.add(p.trim());
  if (extra) {
    for (const p of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      set.add(p);
    }
  }
  return set.size ? [...set.values()].join(",") : undefined;
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

export const startCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);

  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);
  const cmdFlagRaw = a.flags.cmd;
  if (cmdFlagRaw === true) {
    throw new Error("macbox start: --cmd requires a value (e.g., --cmd /path/to/claude)");
  }
  let cmdOverride = asString(cmdFlagRaw);

  const positionalAgent = a._[0];
  const agentRaw = asString(a.flags.agent) ?? (positionalAgent && isAgent(positionalAgent) ? positionalAgent : undefined);
  const agentFlag = agentRaw && isAgent(agentRaw)
    ? agentRaw
    : agentRaw
    ? (() => {
      throw new Error(`macbox start: unknown agent '${agentRaw}'`);
    })()
    : undefined;

  let presetName = asString(a.flags.preset);

  const repo = await detectRepo(repoHint);
  const config = await loadMacboxConfig(repo.root, repo.root);
  const project = await findProjectByPath(repo.root);

  if (!presetName) {
    presetName = config?.defaults?.preset ?? project?.defaultPreset;
  }

  let presetConfig: Awaited<ReturnType<typeof loadPreset>> | null = null;
  if (presetName) {
    presetConfig = await loadPreset(presetName);
  }

  let agent: AgentKind | undefined = agentFlag ?? presetConfig?.preset.agent ??
    config?.defaults?.agent ?? project?.defaultAgent;

  let ambiguous = false;
  if (!agent && !cmdOverride) {
    const detected = await detectAgents();
    const picked = pickDefaultAgent(detected);
    agent = picked.agent;
    ambiguous = picked.ambiguous;
  }

  if (!agent && !cmdOverride && !presetConfig) {
    throw new Error(
      "macbox start: no agent detected. Install 'claude' or 'codex', or use --agent/--preset/--cmd.",
    );
  }

  if (cmdOverride) {
    const looksLikePath = cmdOverride.includes("/") || cmdOverride.startsWith(".");
    if (looksLikePath) {
      try {
        await Deno.stat(cmdOverride);
      } catch {
        throw new Error(`macbox start: --cmd path not found: ${cmdOverride}`);
      }
    }
  }

  let autoProfile: string | null = null;
  let autoCmdNote: string | null = null;
  if (agent && agent !== "custom" && !cmdOverride) {
    const resolved = await resolveAgentPath(agent);
    if (!resolved) {
      throw new Error(
        `macbox start: '${agent}' not found on PATH. Install it or use --cmd /path/to/${agent}.`,
      );
    }
    const home = Deno.env.get("HOME") ?? "";
    if (home && resolved.startsWith(`${home}/`)) {
      autoProfile = agent === "claude" ? "host-claude" : "host-tools";
      cmdOverride = resolved;
      autoCmdNote = `auto-enabled ${autoProfile} and --cmd ${resolved} (agent is under HOME)`;
    }
  }

  const defaultProfiles = [
    ...(config?.defaults?.profiles ?? []),
    ...(project?.defaultProfiles ?? []),
  ];

  const profileFlag = mergeProfiles(
    autoProfile ? [...defaultProfiles, autoProfile] : defaultProfiles,
    asString(a.flags.profile),
  );

  const worktreeOverride = asString(a.flags.worktree);
  const prefix = presetConfig?.preset.worktreePrefix ??
    (agent && agent !== "custom" ? `ai-${agent}` : "ai-custom");

  const worktreeName = worktreeOverride ?? await nextWorktreeName({
    baseDir: base,
    repoRoot: repo.root,
    prefix,
  });

  const runArgv: string[] = [];
  if (agent) runArgv.push("--agent", agent);
  if (presetName) runArgv.push("--preset", presetName);
  if (cmdOverride) runArgv.push("--cmd", cmdOverride);
  runArgv.push("--worktree", worktreeName);

  const branch = asString(a.flags.branch);
  if (branch) runArgv.push("--branch", branch);

  if (profileFlag) runArgv.push("--profile", profileFlag);

  pushFlag(runArgv, "allow-network", a.flags["allow-network"]);
  pushFlag(runArgv, "block-network", a.flags["block-network"]);
  pushFlag(runArgv, "no-network", a.flags["no-network"]);
  pushFlag(runArgv, "allow-exec", a.flags["allow-exec"]);
  pushFlag(runArgv, "block-exec", a.flags["block-exec"]);
  pushFlag(runArgv, "allow-fs-read", a.flags["allow-fs-read"]);
  pushFlag(runArgv, "allow-fs-rw", a.flags["allow-fs-rw"]);
  pushFlag(runArgv, "debug", a.flags.debug);
  pushFlag(runArgv, "trace", a.flags.trace);

  if (a.flags.repo) runArgv.push("--repo", String(a.flags.repo));
  if (a.flags.base) runArgv.push("--base", String(a.flags.base));

  if (a.passthrough.length) {
    runArgv.push("--", ...a.passthrough);
  }

  console.log("macbox: start");
  if (agent) console.log(`  agent:    ${agent}`);
  if (presetName) console.log(`  preset:   ${presetName}`);
  console.log(`  worktree: ${worktreeName}`);
  if (ambiguous) {
    console.log("  note: both claude and codex detected; defaulting to claude (use --agent to override)");
  }
  if (autoCmdNote) {
    console.log(`  note: ${autoCmdNote}`);
  }

  return await runCmd(runArgv);
};
