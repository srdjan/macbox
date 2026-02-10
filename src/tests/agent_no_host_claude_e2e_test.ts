import { assert } from "./testutil.ts";

const td = new TextDecoder();

type CmdResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

const runCmd = async (
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  },
): Promise<CmdResult> => {
  const out = await new Deno.Command(cmd, {
    args: [...args],
    cwd: opts?.cwd,
    env: opts?.env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: td.decode(out.stdout).trim(),
    stderr: td.decode(out.stderr).trim(),
  };
};

const mustSucceed = async (
  cmd: string,
  args: ReadonlyArray<string>,
  opts?: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  },
) => {
  const r = await runCmd(cmd, args, opts);
  assert(
    r.code === 0,
    `expected success for ${cmd} ${args.join(" ")}:\n${r.stderr || r.stdout}`,
  );
  return r;
};

const findSessionFile = async (baseDir: string): Promise<string> => {
  const root = `${baseDir}/sessions`;
  const out: string[] = [];
  for await (const repoEnt of Deno.readDir(root)) {
    if (!repoEnt.isDirectory) continue;
    const repoDir = `${root}/${repoEnt.name}`;
    for await (const fileEnt of Deno.readDir(repoDir)) {
      if (fileEnt.isFile && fileEnt.name.endsWith(".json")) {
        out.push(`${repoDir}/${fileEnt.name}`);
      }
    }
  }
  assert(
    out.length === 1,
    `expected exactly one session file, got: ${out.length}`,
  );
  return out[0];
};

Deno.test("agent e2e toggles host-claude profile with --no-host-claude-profile", async () => {
  if (Deno.build.os !== "darwin") return;
  try {
    await Deno.stat("/usr/bin/sandbox-exec");
  } catch {
    return;
  }

  const tmp = await Deno.makeTempDir({
    dir: Deno.cwd(),
    prefix: "macbox-e2e-host-",
  });
  try {
    const repoDir = `${tmp}/repo`;
    const base1 = `${tmp}/base-one`;
    const base2 = `${tmp}/base-two`;
    const fakeHome = `${tmp}/home`;
    const toolsDir = `${tmp}/tools`;
    const presetPath = `${tmp}/preset-claude.json`;

    await Deno.mkdir(repoDir, { recursive: true });
    await Deno.mkdir(base1, { recursive: true });
    await Deno.mkdir(base2, { recursive: true });
    await Deno.mkdir(`${fakeHome}/.claude`, { recursive: true });
    await Deno.mkdir(toolsDir, { recursive: true });

    await mustSucceed("git", ["init", "-q"], { cwd: repoDir });
    await mustSucceed("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await mustSucceed("git", ["config", "user.name", "test"], { cwd: repoDir });
    await Deno.writeTextFile(`${repoDir}/README.md`, "hello\n");
    await mustSucceed("git", ["add", "README.md"], { cwd: repoDir });
    await mustSucceed("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });

    await Deno.writeTextFile(`${toolsDir}/claude`, "#!/bin/sh\nexit 0\n");
    await Deno.chmod(`${toolsDir}/claude`, 0o755);
    await Deno.writeTextFile(
      presetPath,
      JSON.stringify({ name: "e2e-claude", agent: "claude", profiles: [] }),
    );

    const env = {
      HOME: fakeHome,
      PATH: `${toolsDir}:${Deno.env.get("PATH") ?? ""}`,
      ANTHROPIC_API_KEY: "dummy",
    };

    const runDefault = await runCmd(
      Deno.execPath(),
      [
        "run",
        "-A",
        "src/main.ts",
        "--prompt",
        "ping",
        "--preset",
        presetPath,
        "--repo",
        repoDir,
        "--base",
        base1,
        "--worktree",
        "wt-one",
        "--new-worktree",
        "--allow-fs-read",
        toolsDir,
      ],
      { cwd: Deno.cwd(), env },
    );
    assert(runDefault.code === 0, `default run failed: ${runDefault.stderr}`);
    assert(
      runDefault.stderr.includes("auto-enabled host-claude profile"),
      "expected host-claude auto-enable warning in default run",
    );

    const runNoHost = await runCmd(
      Deno.execPath(),
      [
        "run",
        "-A",
        "src/main.ts",
        "--prompt",
        "ping",
        "--preset",
        presetPath,
        "--repo",
        repoDir,
        "--base",
        base2,
        "--worktree",
        "wt-two",
        "--new-worktree",
        "--allow-fs-read",
        toolsDir,
        "--no-host-claude-profile",
      ],
      { cwd: Deno.cwd(), env },
    );
    assert(runNoHost.code === 0, `no-host run failed: ${runNoHost.stderr}`);
    assert(
      !runNoHost.stderr.includes("auto-enabled host-claude profile"),
      "did not expect host-claude auto-enable warning with --no-host-claude-profile",
    );

    const session1Path = await findSessionFile(base1);
    const session2Path = await findSessionFile(base2);
    const s1 = JSON.parse(await Deno.readTextFile(session1Path)) as {
      readonly profiles?: ReadonlyArray<string>;
    };
    const s2 = JSON.parse(await Deno.readTextFile(session2Path)) as {
      readonly profiles?: ReadonlyArray<string>;
    };

    assert(
      (s1.profiles ?? []).includes("host-claude"),
      "expected host-claude in default run session profiles",
    );
    assert(
      !(s2.profiles ?? []).includes("host-claude"),
      "did not expect host-claude in --no-host-claude-profile session profiles",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => undefined);
  }
});
