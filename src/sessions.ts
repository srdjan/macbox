import { ensureDir } from "./fs.ts";
import { pathJoin } from "./os.ts";
import { repoIdForRoot, sessionFileFor } from "./paths.ts";
import type { AgentKind } from "./agent.ts";

export type SessionCaps = {
  readonly network: boolean;
  readonly exec: boolean;
  readonly extraRead: ReadonlyArray<string>;
  readonly extraWrite: ReadonlyArray<string>;
};

export type SessionRecord = {
  readonly id: string; // `${repoId}/${worktreeName}`
  readonly repoId: string;
  readonly repoRoot: string;
  readonly worktreeName: string;
  readonly worktreePath: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent?: AgentKind;
  readonly profiles: ReadonlyArray<string>;
  readonly caps: SessionCaps;
  readonly debug: boolean;
  readonly trace: boolean;
  readonly lastCommand?: ReadonlyArray<string>;
  readonly lastCommandLine?: string;
  readonly createdAt: string; // ISO
  readonly updatedAt: string; // ISO
};

const isoNow = () => new Date().toISOString();

const atomicWriteJson = async (filePath: string, obj: unknown) => {
  const dir = filePath.split("/").slice(0, -1).join("/") || ".";
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(obj, null, 2) + "\n", { create: true });
  await Deno.rename(tmp, filePath);
};

export const saveSession = async (args: {
  readonly baseDir: string;
  readonly repoRoot: string;
  readonly worktreeName: string;
  readonly worktreePath: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly agent?: AgentKind;
  readonly profiles: ReadonlyArray<string>;
  readonly caps: SessionCaps;
  readonly debug: boolean;
  readonly trace: boolean;
  readonly lastCommand?: ReadonlyArray<string>;
  readonly lastCommandLine?: string;
}): Promise<SessionRecord> => {
  const repoId = await repoIdForRoot(args.repoRoot);
  const id = `${repoId}/${args.worktreeName}`;
  const filePath = await sessionFileFor(args.baseDir, args.repoRoot, args.worktreeName);

  let createdAt = isoNow();
  try {
    const existing = await loadSessionById({ baseDir: args.baseDir, id });
    createdAt = existing.createdAt;
  } catch {
    // ignore if missing/corrupt
  }

  const rec: SessionRecord = {
    id,
    repoId,
    repoRoot: args.repoRoot,
    worktreeName: args.worktreeName,
    worktreePath: args.worktreePath,
    gitCommonDir: args.gitCommonDir,
    gitDir: args.gitDir,
    agent: args.agent,
    profiles: args.profiles,
    caps: args.caps,
    debug: args.debug,
    trace: args.trace,
    lastCommand: args.lastCommand,
    lastCommandLine: args.lastCommandLine,
    createdAt,
    updatedAt: isoNow(),
  };

  await atomicWriteJson(filePath, rec);
  return rec;
};

const readJson = async (p: string): Promise<unknown> => {
  const s = await Deno.readTextFile(p);
  return JSON.parse(s);
};

const isSession = (v: any): v is SessionRecord =>
  v && typeof v === "object" &&
  typeof v.id === "string" &&
  typeof v.repoId === "string" &&
  typeof v.repoRoot === "string" &&
  typeof v.worktreeName === "string" &&
  typeof v.worktreePath === "string" &&
  typeof v.gitCommonDir === "string" &&
  typeof v.gitDir === "string" &&
  v.caps && typeof v.caps.network === "boolean" && typeof v.caps.exec === "boolean";

export const sessionFileFromId = (baseDir: string, id: string): string => {
  // id can be:
  // - "repoId/worktreeName"
  // - "worktreeName" (resolved later with repoRoot)
  // - "latest" (handled elsewhere)
  if (id.includes("/")) {
    const [repoId, ...rest] = id.split("/");
    const wt = rest.join("/");
    return pathJoin(baseDir, "sessions", repoId, `${wt}.json`);
  }
  // Fallback: treat as "worktreeName" across unknown repo => caller must resolve
  return pathJoin(baseDir, "sessions", "__unknown__", `${id}.json`);
};

export const loadSessionById = async (args: {
  readonly baseDir: string;
  readonly id: string; // must be "repoId/worktreeName"
}): Promise<SessionRecord> => {
  const p = sessionFileFromId(args.baseDir, args.id);
  const j = await readJson(p);
  if (!isSession(j)) throw new Error(`macbox: invalid session file: ${p}`);
  return j;
};

export const listSessions = async (args: {
  readonly baseDir: string;
  readonly repoRoot?: string;
  readonly agent?: AgentKind;
}): Promise<ReadonlyArray<SessionRecord>> => {
  const sessionsBase = pathJoin(args.baseDir, "sessions");

  const repoDirs: string[] = [];
  if (args.repoRoot) {
    const repoId = await repoIdForRoot(args.repoRoot);
    repoDirs.push(pathJoin(sessionsBase, repoId));
  } else {
    try {
      for await (const ent of Deno.readDir(sessionsBase)) {
        if (ent.isDirectory) repoDirs.push(pathJoin(sessionsBase, ent.name));
      }
    } catch {
      return [];
    }
  }

  const out: SessionRecord[] = [];
  for (const dir of repoDirs) {
    try {
      for await (const ent of Deno.readDir(dir)) {
        if (!ent.isFile || !ent.name.endsWith(".json")) continue;
        const p = pathJoin(dir, ent.name);
        try {
          const j = await readJson(p);
          if (!isSession(j)) continue;
          const rec = j as SessionRecord;
          if (args.agent && rec.agent !== args.agent) continue;
          out.push(rec);
        } catch {
          // ignore invalid
        }
      }
    } catch {
      // ignore missing
    }
  }

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
};

export const findLatestSession = async (args: {
  readonly baseDir: string;
  readonly repoRoot?: string;
  readonly agent?: AgentKind;
}): Promise<SessionRecord | null> => {
  const xs = await listSessions(args);
  return xs.length ? xs[0] : null;
};

export const resolveSessionIdForRepo = async (args: {
  readonly baseDir: string;
  readonly repoRoot: string;
  readonly ref: string; // "latest" | "worktreeName" | "repoId/worktreeName"
  readonly agent?: AgentKind;
}): Promise<string> => {
  if (args.ref === "latest") {
    const s = await findLatestSession({ baseDir: args.baseDir, repoRoot: args.repoRoot, agent: args.agent });
    if (!s) throw new Error("macbox: no sessions found (latest)");
    return s.id;
  }
  if (args.ref.includes("/")) return args.ref;
  // treat as worktreeName in this repo
  const repoId = await repoIdForRoot(args.repoRoot);
  return `${repoId}/${args.ref}`;
};

export const deleteSession = async (args: { readonly baseDir: string; readonly id: string }) => {
  const p = sessionFileFromId(args.baseDir, args.id);
  await Deno.remove(p);
};

export const deleteAllSessions = async (args: { readonly baseDir: string; readonly repoRoot?: string }) => {
  const sessionsBase = pathJoin(args.baseDir, "sessions");
  if (args.repoRoot) {
    const repoId = await repoIdForRoot(args.repoRoot);
    const dir = pathJoin(sessionsBase, repoId);
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    return;
  }
  await Deno.remove(sessionsBase, { recursive: true }).catch(() => undefined);
};
