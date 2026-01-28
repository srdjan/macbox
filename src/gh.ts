import { exec, type ExecRes } from "./exec.ts";

export const ghAvailable = async (): Promise<boolean> => {
  try {
    const r = await exec(["which", "gh"], { quiet: true });
    return r.code === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
};

export const ghExec = async (
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<ExecRes> => {
  const available = await ghAvailable();
  if (!available) {
    return {
      code: 1,
      stdout: "",
      stderr: "macbox: 'gh' CLI not found. Install from https://cli.github.com/",
    };
  }
  return await exec(["gh", ...args], { cwd, quiet: true });
};
