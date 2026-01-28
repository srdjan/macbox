import { ensureDir, writeText } from "./fs.ts";
import { pathJoin } from "./os.ts";
import { exec } from "./exec.ts";

export type RepoState = {
  readonly branch: string;
  readonly commitSha: string;
  readonly dirty: boolean;
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly untrackedCount: number;
};

export type ContextPack = {
  readonly packId: string;
  readonly workspaceId?: string;
  readonly createdAt: string;
  readonly repoState: RepoState;
};

const isoNow = () => new Date().toISOString();

const randomId = () => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const newPackId = () => `pack-${randomId()}`;

const packsRoot = (worktreePath: string) =>
  pathJoin(worktreePath, ".macbox", "context", "packs");

const captureRepoState = async (worktreePath: string): Promise<RepoState> => {
  const branchResult = await exec(
    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: worktreePath, quiet: true },
  );
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : "unknown";

  const shaResult = await exec(
    ["git", "rev-parse", "HEAD"],
    { cwd: worktreePath, quiet: true },
  );
  const commitSha = shaResult.code === 0 ? shaResult.stdout.trim() : "unknown";

  const statusResult = await exec(
    ["git", "status", "--porcelain"],
    { cwd: worktreePath, quiet: true },
  );
  const statusLines = statusResult.code === 0
    ? statusResult.stdout.split("\n").filter((l) => l.trim().length > 0)
    : [];

  const modifiedFiles = statusLines
    .filter((l) => !l.startsWith("??"))
    .map((l) => l.slice(3).trim());
  const untrackedCount = statusLines.filter((l) => l.startsWith("??")).length;
  const dirty = statusLines.length > 0;

  return { branch, commitSha, dirty, modifiedFiles, untrackedCount };
};

const captureDiff = async (worktreePath: string): Promise<string> => {
  const result = await exec(["git", "diff"], { cwd: worktreePath, quiet: true });
  return result.code === 0 ? result.stdout : "";
};

const captureLog = async (worktreePath: string): Promise<string> => {
  const result = await exec(
    ["git", "log", "--oneline", "-10"],
    { cwd: worktreePath, quiet: true },
  );
  return result.code === 0 ? result.stdout : "";
};

export const createContextPack = async (args: {
  readonly worktreePath: string;
  readonly workspaceId?: string;
  readonly summary?: string;
  readonly notes?: string;
}): Promise<ContextPack> => {
  const packId = newPackId();
  const packDir = pathJoin(packsRoot(args.worktreePath), packId);
  await ensureDir(packDir);

  const repoState = await captureRepoState(args.worktreePath);
  const diff = await captureDiff(args.worktreePath);
  const log = await captureLog(args.worktreePath);
  const now = isoNow();

  const pack: ContextPack = {
    packId,
    workspaceId: args.workspaceId,
    createdAt: now,
    repoState,
  };

  // Write pack metadata
  await writeText(
    pathJoin(packDir, "pack.json"),
    JSON.stringify(pack, null, 2) + "\n",
  );

  // Write repo state
  await writeText(
    pathJoin(packDir, "repo_state.json"),
    JSON.stringify(repoState, null, 2) + "\n",
  );

  // Write diff
  if (diff) {
    await writeText(pathJoin(packDir, "diff.patch"), diff + "\n");
  }

  // Write summary
  const summaryText = args.summary ??
    `Context pack for ${repoState.branch} at ${repoState.commitSha.slice(0, 8)}\n` +
    `Created: ${now}\n` +
    (repoState.dirty ? `Modified files: ${repoState.modifiedFiles.length}\n` : "Clean working tree\n");
  await writeText(pathJoin(packDir, "summary.md"), summaryText);

  // Write notes
  await writeText(pathJoin(packDir, "notes.md"), args.notes ?? "");

  // Write recent commands/log
  await writeText(pathJoin(packDir, "commands.log"), `# Recent git log\n${log}\n`);

  return pack;
};

export const loadContextPack = async (
  worktreePath: string,
  packId: string,
): Promise<ContextPack> => {
  const packDir = pathJoin(packsRoot(worktreePath), packId);
  const txt = await Deno.readTextFile(pathJoin(packDir, "pack.json"));
  const j = JSON.parse(txt);
  if (!j || typeof j !== "object" || typeof j.packId !== "string") {
    throw new Error(`macbox: invalid context pack: ${packDir}`);
  }
  return j as ContextPack;
};

export const listContextPacks = async (
  worktreePath: string,
): Promise<ReadonlyArray<ContextPack>> => {
  const root = packsRoot(worktreePath);
  const packs: ContextPack[] = [];

  try {
    for await (const ent of Deno.readDir(root)) {
      if (!ent.isDirectory) continue;
      try {
        const pack = await loadContextPack(worktreePath, ent.name);
        packs.push(pack);
      } catch {
        // ignore invalid
      }
    }
  } catch {
    // no packs dir
  }

  packs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return packs;
};

export const contextPackDir = (worktreePath: string, packId: string) =>
  pathJoin(packsRoot(worktreePath), packId);
