import { worktreeDir } from "./paths.ts";

const pathExists = async (p: string): Promise<boolean> => {
  try {
    const st = await Deno.stat(p);
    return st.isDirectory || st.isFile;
  } catch {
    return false;
  }
};

export const nextWorktreeName = async (args: {
  readonly baseDir: string;
  readonly repoRoot: string;
  readonly prefix: string;
  readonly maxAttempts?: number;
}): Promise<string> => {
  const max = args.maxAttempts ?? 9999;
  for (let i = 1; i <= max; i++) {
    const name = `${args.prefix}-${i}`;
    const dir = await worktreeDir(args.baseDir, args.repoRoot, name);
    if (!(await pathExists(dir))) return name;
  }
  throw new Error(
    `macbox: unable to find free worktree name for prefix '${args.prefix}' (1..${max})`,
  );
};
