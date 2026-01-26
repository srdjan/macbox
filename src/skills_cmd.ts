import { parseArgs } from "./mini_args.ts";
import { detectRepo, ensureWorktree } from "./git.ts";
import { defaultBaseDir, worktreeDir } from "./paths.ts";
import { ensureDir, ensureGitignoreInmacbox } from "./fs.ts";
import { writeSeatbeltProfile } from "./seatbelt.ts";
import {
  detectSandboxExec,
  runSandboxed,
  runSandboxedCapture,
} from "./sandbox_exec.ts";
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
  expandSkill,
  initSkill,
  listSkills,
  loadSkillByName,
} from "./skills.ts";
import {
  buildSkillsRegistry,
  registryDefaultPaths,
  writeSkillsRegistry,
} from "./skills_registry.ts";
import { formatContractText, skillsContractV1 } from "./skills_contract.ts";
import { mustExec } from "./exec.ts";

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

const defaultWorktreeName = (agent: AgentKind | undefined) => {
  if (!agent || agent === "custom") return "ai";
  return `ai-${agent}`;
};

const printSkills = (
  worktreePath: string,
  xs: ReadonlyArray<
    { name: string; scope: string; dir: string; description?: string }
  >,
) => {
  if (xs.length === 0) {
    console.log("(no skills found)");
    console.log(`Hint: create one with: macbox skills init <name>`);
    return;
  }
  for (const s of xs) {
    const rel = s.dir.startsWith(worktreePath)
      ? s.dir.slice(worktreePath.length + 1)
      : s.dir;
    const desc = s.description ? ` — ${s.description}` : "";
    console.log(`${s.name}\t${s.scope}\t${rel}${desc}`);
  }
};

const relPath = (worktreePath: string, absPath: string): string => {
  if (absPath === worktreePath) return ".";
  return absPath.startsWith(worktreePath + "/")
    ? absPath.slice(worktreePath.length + 1)
    : absPath;
};

const resolveSkillFile = (
  skillDir: string,
  fileFlag: string | undefined,
): string => {
  const f = (fileFlag ?? "skill.json").trim();
  if (f === "dir" || f === ".") return skillDir;
  if (f === "skill.json" || f === "manifest" || f === "manifest.json") {
    return `${skillDir}/skill.json`;
  }
  if (f === "run.ts" || f === "run") return `${skillDir}/run.ts`;
  if (f === "README.md" || f === "readme") return `${skillDir}/README.md`;
  // allow arbitrary relative file under the skill dir
  if (f.startsWith("/")) return f;
  return `${skillDir}/${f}`;
};

const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

const openPath = async (path: string): Promise<void> => {
  const visual = Deno.env.get("VISUAL");
  const editor = Deno.env.get("EDITOR");
  const chosen = (visual && visual.trim())
    ? visual
    : (editor && editor.trim())
    ? editor
    : "";

  if (chosen) {
    // Use a shell so users can set EDITOR="code -r" etc.
    await mustExec(["/bin/sh", "-lc", `${chosen} ${shQuote(path)}`], {
      label: "skills edit",
    });
    return;
  }

  // macOS fallback: open in default app
  // If it looks like a directory, `open <dir>`; otherwise `open -t <file>`.
  try {
    const st = await Deno.stat(path);
    if (st.isDirectory) {
      await mustExec(["/usr/bin/open", path], { label: "skills edit" });
    } else {
      await mustExec(["/usr/bin/open", "-t", path], { label: "skills edit" });
    }
  } catch {
    await mustExec(["/usr/bin/open", "-t", path], { label: "skills edit" });
  }
};

export const skillsCmd = async (argv: ReadonlyArray<string>) => {
  const a = parseArgs(argv);
  const [sub, ...rest] = a._;

  if (!sub || sub === "help") {
    console.log(
      [
        "macbox skills — local sandbox tools",
        "",
        "Usage:",
        "  macbox skills list [--json] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]",
        "  macbox skills describe <name> [--json] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]",
        "  macbox skills registry [--json] [--write] [--committed] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]",
        "  macbox skills contract [--json]",
        "  macbox skills path <name> [--file <skill.json|run.ts|README.md|dir>] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]",
        "  macbox skills edit <name> [--file <...>] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]",
        "  macbox skills init <name> [--local] [--worktree <name>] [--session <ref>] [--repo <path>] [--base <path>]",
        "  macbox skills run  <name> [--json] [--capture] [--worktree <name>] [--session <ref>] [--agent claude|codex]",
        "                    [--profile <name[,name2...]>] [--allow-network|--block-network] [--allow-exec|--block-exec]",
        "                    [--allow-fs-read <p1[,p2...]>] [--allow-fs-rw <p1[,p2...]>] [--debug] [--trace]",
        "                    [--repo <path>] [--base <path>] -- <skill args...>",
        "",
        "Skills live inside the worktree:",
        "  • committed: <worktree>/skills/<skill>/skill.json",
        "  • local:     <worktree>/.macbox/skills/<skill>/skill.json (gitignored)",
        "",
      ].join("\n"),
    );
    return { code: 0 };
  }

  // Re-parse args for subcommands so we can treat a._ consistently.
  const a2 = parseArgs([
    sub,
    ...rest,
    ...a.passthrough.length ? ["--", ...a.passthrough] : [],
  ]);

  const jsonOut = boolFlag(a2.flags.json, false);

  // Contract does not depend on being inside a git repo.
  if (sub === "contract") {
    if (jsonOut) {
      console.log(JSON.stringify(skillsContractV1, null, 2));
    } else {
      console.log(formatContractText(skillsContractV1));
    }
    return { code: 0 };
  }

  const repoHint = asString(a2.flags.repo);
  const base = asString(a2.flags.base) ?? defaultBaseDir();

  const agentFlagRaw = asString(a2.flags.agent);
  const agentFlag: AgentKind | undefined = agentFlagRaw
    ? (agentFlagRaw === "claude" || agentFlagRaw === "codex" ||
        agentFlagRaw === "custom")
      ? agentFlagRaw
      : (() => {
        throw new Error(`macbox: unknown --agent: ${agentFlagRaw}`);
      })()
    : undefined;

  const worktreeFlag = asString(a2.flags.worktree);
  const sessionRef = asString(a2.flags.session);
  const startPoint = asString(a2.flags.branch) ?? "HEAD";

  const trace = boolFlag(a2.flags.trace, false);
  const debug = boolFlag(a2.flags.debug, false) || trace;

  const repo = await detectRepo(repoHint);

  // Optional session: reuse defaults.
  let sessionRec: Awaited<ReturnType<typeof loadSessionById>> | null = null;
  if (sessionRef) {
    const sid = await resolveSessionIdForRepo({
      baseDir: base,
      repoRoot: repo.root,
      ref: sessionRef,
      agent: agentFlag && agentFlag !== "custom" ? agentFlag : undefined,
    });
    sessionRec = await loadSessionById({ baseDir: base, id: sid });
  }

  const inferredLatest = !worktreeFlag
    ? await findLatestSession({
      baseDir: base,
      repoRoot: repo.root,
      agent: (agentFlag && agentFlag !== "custom")
        ? agentFlag
        : (sessionRec?.agent && sessionRec.agent !== "custom"
          ? sessionRec.agent
          : undefined),
    })
    : null;

  const effectiveAgent: AgentKind | undefined = agentFlag ?? sessionRec?.agent;
  const worktreeName = worktreeFlag ?? sessionRec?.worktreeName ??
    inferredLatest?.worktreeName ?? defaultWorktreeName(effectiveAgent);
  const wtPath = await worktreeDir(base, repo.root, worktreeName);

  // Ensure worktree exists
  await ensureWorktree(repo.root, wtPath, `macbox/${worktreeName}`, startPoint);

  // Ensure .macbox dirs
  const mp = `${wtPath}/.macbox`;
  await ensureDir(`${mp}/home`);
  await ensureDir(`${mp}/cache`);
  await ensureDir(`${mp}/tmp`);
  await ensureDir(`${mp}/logs`);
  await ensureGitignoreInmacbox(wtPath);

  if (sub === "list") {
    const skills = await listSkills(wtPath);
    if (jsonOut) {
      const out = skills.map((s) => ({
        name: s.name,
        scope: s.scope,
        dir: relPath(wtPath, s.dir),
        description: s.manifest.description,
      }));
      console.log(JSON.stringify(out, null, 2));
    } else {
      printSkills(
        wtPath,
        skills.map((s) => ({
          name: s.name,
          scope: s.scope,
          dir: s.dir,
          description: s.manifest.description,
        })),
      );
    }
    return { code: 0 };
  }

  if (sub === "init") {
    const name = a2._[1];
    if (!name) throw new Error("macbox skills init: missing <name>");
    const local = boolFlag(a2.flags.local, false);
    const created = await initSkill({ worktreePath: wtPath, name, local });
    console.log(
      `macbox: initialized skill '${created.name}' at: ${created.dir}`,
    );
    return { code: 0 };
  }

  if (sub === "describe") {
    const name = a2._[1];
    if (!name) throw new Error("macbox skills describe: missing <name>");
    const skill = await loadSkillByName(wtPath, name);
    const payload = {
      name: skill.name,
      scope: skill.scope,
      dir: relPath(wtPath, skill.dir),
      manifest: skill.manifest,
    };
    if (jsonOut) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      const desc = skill.manifest.description
        ? `\nDescription: ${skill.manifest.description}`
        : "";
      console.log(
        [
          `Skill: ${skill.name}`,
          `Scope: ${skill.scope}`,
          `Dir: ${payload.dir}`,
          desc,
          "",
          "Manifest:",
          JSON.stringify(skill.manifest, null, 2),
        ].join("\n"),
      );
    }
    return { code: 0 };
  }

  if (sub === "registry") {
    const write = boolFlag(a2.flags.write, false);
    const committed = boolFlag(a2.flags.committed, false);
    const reg = await buildSkillsRegistry(wtPath);

    if (write) {
      const paths = registryDefaultPaths(wtPath);
      const dest = committed ? paths.committed : paths.local;
      await writeSkillsRegistry(wtPath, dest, reg);
      console.log(dest);
    } else if (jsonOut) {
      console.log(JSON.stringify(reg, null, 2));
    } else {
      console.log(`Skills registry (v1) — ${reg.skills.length} skills`);
      for (const s of reg.skills) {
        const desc = s.description ? ` — ${s.description}` : "";
        console.log(`- ${s.name} (${s.scope}) ${s.dir}${desc}`);
      }
      console.log("");
      console.log("Tip: write a machine-readable registry file:");
      console.log("  macbox skills registry --write");
    }
    return { code: 0 };
  }

  if (sub === "path") {
    const name = a2._[1];
    if (!name) throw new Error("macbox skills path: missing <name>");
    const fileFlag = asString(a2.flags.file);
    const skill = await loadSkillByName(wtPath, name);
    console.log(resolveSkillFile(skill.dir, fileFlag));
    return { code: 0 };
  }

  if (sub === "edit") {
    const name = a2._[1];
    if (!name) throw new Error("macbox skills edit: missing <name>");
    const fileFlag = asString(a2.flags.file);
    const skill = await loadSkillByName(wtPath, name);
    const target = resolveSkillFile(skill.dir, fileFlag);
    await openPath(target);
    return { code: 0 };
  }

  if (sub === "run") {
    const name = a2._[1];
    if (!name) throw new Error("macbox skills run: missing <name>");

    const profileFlag = asString(a2.flags.profile);

    // Load profiles (agent implies a bundled profile)
    const agentProfiles = effectiveAgent
      ? defaultAgentProfiles(effectiveAgent)
      : [];
    const profileNames = [
      ...agentProfiles,
      ...(sessionRec?.profiles ?? []),
      ...parseProfileNames(profileFlag),
    ];
    const loadedProfiles = profileNames.length
      ? await loadProfiles(wtPath, profileNames)
      : null;

    // Capabilities (session defaults, overridden by flags)
    const defaultNetwork = sessionRec?.caps.network ?? true;
    const defaultExec = sessionRec?.caps.exec ?? true;

    const network =
      (a2.flags["allow-network"] !== undefined ||
          a2.flags["block-network"] !== undefined ||
          a2.flags["no-network"] !== undefined)
        ? (boolFlag(a2.flags["allow-network"], true) &&
          !boolFlag(a2.flags["block-network"], false) &&
          !boolFlag(a2.flags["no-network"], false))
        : defaultNetwork;

    const exec =
      (a2.flags["allow-exec"] !== undefined ||
          a2.flags["block-exec"] !== undefined)
        ? (boolFlag(a2.flags["allow-exec"], true) &&
          !boolFlag(a2.flags["block-exec"], false))
        : defaultExec;

    const cliExtraRead = parsePathList(a2.flags["allow-fs-read"]);
    const cliExtraWrite = parsePathList(a2.flags["allow-fs-rw"]);

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

    if (mergedExtraWrite.length) {
      for (const p of mergedExtraWrite) {
        const ok = p.startsWith(wtPath) || p.startsWith(repo.gitCommonDir) ||
          p.startsWith(repo.gitDir);
        if (!ok) {
          console.error(
            `macbox: WARNING: write access outside sandbox worktree: ${p}`,
          );
        }
      }
    }

    // Generate profile
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

    const skill = await loadSkillByName(wtPath, name);
    const expanded = expandSkill(skill, wtPath);

    // Append passthrough args after `--`
    const cmd = [...expanded.command, ...a2.passthrough];

    const sx = await detectSandboxExec();
    const env = sandboxEnv(wtPath, effectiveAgent);
    const sessionId = `${worktreeName}-${nowCompact()}`;
    env["MACBOX_SESSION"] = sessionId;
    env["MACBOX_WORKTREE"] = wtPath;
    env["MACBOX_SKILL"] = skill.name;
    env["MACBOX_SKILL_DIR"] = skill.dir;
    env["MACBOX_SKILL_ARGS_JSON"] = JSON.stringify(a2.passthrough);

    const resultOverride = asString(a2.flags.result);
    const resultPath = resultOverride
      ? (resultOverride.startsWith("/")
        ? resultOverride
        : `${wtPath}/${resultOverride}`)
      : `${mp}/tmp/skill-result-${sessionId}.json`;
    env["MACBOX_RESULT_PATH"] = resultPath;
    env["MACBOX_RESULT_FORMAT"] = "json";

    // Expand env from manifest
    for (const [k, v] of Object.entries(expanded.env)) env[k] = v;

    const cmdLine = cmd.join(" ");
    const traceStart = new Date(Date.now() - 1500);

    // Persist session metadata (skills run counts as a session activity)
    try {
      await saveSession({
        baseDir: base,
        repoRoot: repo.root,
        worktreeName,
        worktreePath: wtPath,
        gitCommonDir: repo.gitCommonDir,
        gitDir: repo.gitDir,
        agent: effectiveAgent,
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

    const capture = boolFlag(a2.flags.capture, false) || jsonOut;
    let cap: Awaited<ReturnType<typeof runSandboxedCapture>> | null = null;
    let code = 1;
    try {
      const runArgs = {
        profilePath,
        params: {
          WORKTREE: wtPath,
          GIT_COMMON_DIR: repo.gitCommonDir,
          GIT_DIR: repo.gitDir,
        },
        workdir: expanded.cwd,
        env,
        command: cmd,
      };
      if (capture) {
        cap = await runSandboxedCapture(sx, runArgs, { stdin: "inherit" });
        code = cap.code;
      } else {
        code = await runSandboxed(sx, runArgs);
      }
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

    // If jsonOut, emit a clean machine-readable envelope (stdout/stderr captured).
    if (jsonOut) {
      const skillRel = relPath(wtPath, skill.dir);
      let result: unknown = undefined;
      let resultError: string | undefined = undefined;
      try {
        const txt = await Deno.readTextFile(resultPath);
        result = JSON.parse(txt);
      } catch (err) {
        // Only treat as error if the file exists but failed to parse.
        try {
          await Deno.stat(resultPath);
          resultError = err instanceof Error ? err.message : String(err);
        } catch {
          // file doesn't exist
        }
      }

      const envelope = {
        schema: "macbox.skills.run.v1",
        ok: code === 0,
        exitCode: code,
        session: sessionId,
        skill: {
          name: skill.name,
          scope: skill.scope,
          dir: skillRel,
        },
        resultPath: relPath(wtPath, resultPath),
        result,
        resultError,
        stdout: cap?.stdout ?? "",
        stderr: cap?.stderr ?? "",
        stdoutTruncated: cap?.stdoutTruncated ?? false,
        stderrTruncated: cap?.stderrTruncated ?? false,
      };
      console.log(JSON.stringify(envelope, null, 2));
    } else if (capture && cap) {
      // User asked to capture, but not JSON envelope. Print captured streams after run.
      if (cap.stdout.length) console.log(cap.stdout);
      if (cap.stderr.length) console.error(cap.stderr);
    }

    return { code };
  }

  throw new Error(`macbox skills: unknown subcommand: ${sub}`);
};
