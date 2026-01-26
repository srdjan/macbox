export type ExecOk = { readonly code: 0; readonly stdout: string; readonly stderr: string };
export type ExecErr = { readonly code: number; readonly stdout: string; readonly stderr: string };
export type ExecRes = ExecOk | ExecErr;

const td = new TextDecoder();

export const exec = async (
  cmd: ReadonlyArray<string>,
  opts?: { cwd?: string; env?: Record<string, string>; quiet?: boolean },
): Promise<ExecRes> => {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts?.cwd,
    env: opts?.env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const out = await p.output();
  const stdout = td.decode(out.stdout).trimEnd();
  const stderr = td.decode(out.stderr).trimEnd();
  if (!opts?.quiet && stderr.length) {
    // keep stderr for debug; don't auto-print by default
  }
  return out.code === 0
    ? { code: 0, stdout, stderr }
    : { code: out.code, stdout, stderr };
};

export const mustExec = async (
  cmd: ReadonlyArray<string>,
  opts?: { cwd?: string; env?: Record<string, string>; quiet?: boolean; label?: string },
): Promise<string> => {
  const r = await exec(cmd, opts);
  if (r.code !== 0) {
    const label = opts?.label ? `${opts.label}: ` : "";
    throw new Error(`${label}command failed (${r.code}): ${cmd.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
};
