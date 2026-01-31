import { atomicWriteJson } from "./fs.ts";
import { pathJoin } from "./os.ts";
import { workspaceDirForProject, workspaceFileFor, workspacesDir } from "./paths.ts";

export type WorkspaceRecord = {
  readonly id: string;
  readonly repoId: string;
  readonly sessionId: string;
  readonly worktreeName: string;
  readonly worktreePath: string;
  readonly name?: string;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
};

const isoNow = () => new Date().toISOString();

const randomId = () => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const newWorkspaceId = () => `ws-${randomId()}`;

const readJson = async (p: string): Promise<unknown> => {
  const s = await Deno.readTextFile(p);
  return JSON.parse(s);
};

const isWorkspace = (v: unknown): v is WorkspaceRecord =>
  !!v && typeof v === "object" &&
  typeof (v as Record<string, unknown>).id === "string" &&
  typeof (v as Record<string, unknown>).repoId === "string" &&
  typeof (v as Record<string, unknown>).sessionId === "string" &&
  typeof (v as Record<string, unknown>).worktreeName === "string";

export const saveWorkspace = async (args: {
  readonly baseDir: string;
  readonly workspace: WorkspaceRecord;
}): Promise<WorkspaceRecord> => {
  const filePath = workspaceFileFor(args.baseDir, args.workspace.repoId, args.workspace.id);
  const rec: WorkspaceRecord = {
    ...args.workspace,
    lastAccessedAt: isoNow(),
  };
  await atomicWriteJson(filePath, rec);
  return rec;
};

export const createWorkspace = async (args: {
  readonly baseDir: string;
  readonly repoId: string;
  readonly sessionId: string;
  readonly worktreeName: string;
  readonly worktreePath: string;
  readonly name?: string;
}): Promise<WorkspaceRecord> => {
  const now = isoNow();
  const rec: WorkspaceRecord = {
    id: newWorkspaceId(),
    repoId: args.repoId,
    sessionId: args.sessionId,
    worktreeName: args.worktreeName,
    worktreePath: args.worktreePath,
    name: args.name,
    createdAt: now,
    lastAccessedAt: now,
  };
  return await saveWorkspace({ baseDir: args.baseDir, workspace: rec });
};

export const loadWorkspace = async (args: {
  readonly baseDir: string;
  readonly repoId: string;
  readonly workspaceId: string;
}): Promise<WorkspaceRecord> => {
  const p = workspaceFileFor(args.baseDir, args.repoId, args.workspaceId);
  const j = await readJson(p);
  if (!isWorkspace(j)) throw new Error(`macbox: invalid workspace file: ${p}`);
  return j;
};

export const listWorkspaces = async (args: {
  readonly baseDir: string;
  readonly repoId?: string;
}): Promise<ReadonlyArray<WorkspaceRecord>> => {
  const base = workspacesDir(args.baseDir);

  const projectDirs: string[] = [];
  if (args.repoId) {
    projectDirs.push(workspaceDirForProject(args.baseDir, args.repoId));
  } else {
    try {
      for await (const ent of Deno.readDir(base)) {
        if (ent.isDirectory) projectDirs.push(pathJoin(base, ent.name));
      }
    } catch {
      return [];
    }
  }

  const out: WorkspaceRecord[] = [];
  for (const dir of projectDirs) {
    try {
      for await (const ent of Deno.readDir(dir)) {
        if (!ent.isFile || !ent.name.endsWith(".json")) continue;
        const p = pathJoin(dir, ent.name);
        try {
          const j = await readJson(p);
          if (!isWorkspace(j)) continue;
          out.push(j);
        } catch {
          // ignore invalid
        }
      }
    } catch {
      // ignore missing
    }
  }

  out.sort((a, b) => (a.lastAccessedAt < b.lastAccessedAt ? 1 : a.lastAccessedAt > b.lastAccessedAt ? -1 : 0));
  return out;
};

export const findLatestWorkspace = async (args: {
  readonly baseDir: string;
  readonly repoId: string;
}): Promise<WorkspaceRecord | null> => {
  const xs = await listWorkspaces(args);
  return xs.length ? xs[0] : null;
};

export const findWorkspaceById = async (args: {
  readonly baseDir: string;
  readonly workspaceId: string;
  readonly repoId?: string;
}): Promise<WorkspaceRecord | null> => {
  // If repoId is known, load directly
  if (args.repoId) {
    try {
      return await loadWorkspace({
        baseDir: args.baseDir,
        repoId: args.repoId,
        workspaceId: args.workspaceId,
      });
    } catch {
      return null;
    }
  }
  // Otherwise scan all projects
  const all = await listWorkspaces({ baseDir: args.baseDir });
  return all.find((w) => w.id === args.workspaceId) ?? null;
};

export const deleteWorkspace = async (args: {
  readonly baseDir: string;
  readonly repoId: string;
  readonly workspaceId: string;
}): Promise<void> => {
  const p = workspaceFileFor(args.baseDir, args.repoId, args.workspaceId);
  await Deno.remove(p);
};

export const updateWorkspace = async (args: {
  readonly baseDir: string;
  readonly workspace: WorkspaceRecord;
  readonly updates: Partial<Pick<WorkspaceRecord, "name">>;
}): Promise<WorkspaceRecord> => {
  const updated: WorkspaceRecord = {
    ...args.workspace,
    ...args.updates,
    lastAccessedAt: isoNow(),
  };
  return await saveWorkspace({ baseDir: args.baseDir, workspace: updated });
};
