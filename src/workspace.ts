import { ensureDir } from "./fs.ts";
import { pathJoin } from "./os.ts";
import { workspaceDirForProject, workspaceFileFor, workspacesDir } from "./paths.ts";

export type WorkspaceStatus = "active" | "archived";

export type WorkspaceParent = {
  readonly branch?: string;
  readonly issue?: number;
  readonly issueTitle?: string;
};

export type FlowRunEntry = {
  readonly flowName: string;
  readonly runAt: string;
  readonly exitCode: number;
};

export type ArchiveRecord = {
  readonly archivedAt: string;
  readonly branchPointer?: string;
  readonly worktreeEvicted: boolean;
  readonly contextPackId?: string;
};

export type WorkspaceRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly worktreeName: string;
  readonly worktreePath: string;
  readonly name?: string;
  readonly status: WorkspaceStatus;
  readonly parent: WorkspaceParent;
  readonly contextPacks: ReadonlyArray<string>;
  readonly flowsRun: ReadonlyArray<FlowRunEntry>;
  readonly archive?: ArchiveRecord;
  readonly createdAt: string;
  readonly updatedAt: string;
};

const isoNow = () => new Date().toISOString();

const randomId = () => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const newWorkspaceId = () => `ws-${randomId()}`;

const atomicWriteJson = async (filePath: string, obj: unknown) => {
  const dir = filePath.split("/").slice(0, -1).join("/") || ".";
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(obj, null, 2) + "\n", { create: true });
  await Deno.rename(tmp, filePath);
};

const readJson = async (p: string): Promise<unknown> => {
  const s = await Deno.readTextFile(p);
  return JSON.parse(s);
};

const isWorkspace = (v: unknown): v is WorkspaceRecord =>
  !!v && typeof v === "object" &&
  typeof (v as Record<string, unknown>).id === "string" &&
  typeof (v as Record<string, unknown>).projectId === "string" &&
  typeof (v as Record<string, unknown>).sessionId === "string" &&
  typeof (v as Record<string, unknown>).worktreeName === "string" &&
  typeof (v as Record<string, unknown>).status === "string";

export const saveWorkspace = async (args: {
  readonly baseDir: string;
  readonly workspace: WorkspaceRecord;
}): Promise<WorkspaceRecord> => {
  const filePath = workspaceFileFor(args.baseDir, args.workspace.projectId, args.workspace.id);
  const rec: WorkspaceRecord = {
    ...args.workspace,
    updatedAt: isoNow(),
  };
  await atomicWriteJson(filePath, rec);
  return rec;
};

export const createWorkspace = async (args: {
  readonly baseDir: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly worktreeName: string;
  readonly worktreePath: string;
  readonly name?: string;
  readonly parent?: WorkspaceParent;
}): Promise<WorkspaceRecord> => {
  const now = isoNow();
  const rec: WorkspaceRecord = {
    id: newWorkspaceId(),
    projectId: args.projectId,
    sessionId: args.sessionId,
    worktreeName: args.worktreeName,
    worktreePath: args.worktreePath,
    name: args.name,
    status: "active",
    parent: args.parent ?? {},
    contextPacks: [],
    flowsRun: [],
    createdAt: now,
    updatedAt: now,
  };
  return await saveWorkspace({ baseDir: args.baseDir, workspace: rec });
};

export const loadWorkspace = async (args: {
  readonly baseDir: string;
  readonly projectId: string;
  readonly workspaceId: string;
}): Promise<WorkspaceRecord> => {
  const p = workspaceFileFor(args.baseDir, args.projectId, args.workspaceId);
  const j = await readJson(p);
  if (!isWorkspace(j)) throw new Error(`macbox: invalid workspace file: ${p}`);
  return j;
};

export const listWorkspaces = async (args: {
  readonly baseDir: string;
  readonly projectId?: string;
  readonly status?: WorkspaceStatus;
}): Promise<ReadonlyArray<WorkspaceRecord>> => {
  const base = workspacesDir(args.baseDir);

  const projectDirs: string[] = [];
  if (args.projectId) {
    projectDirs.push(workspaceDirForProject(args.baseDir, args.projectId));
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
          if (args.status && j.status !== args.status) continue;
          out.push(j);
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

export const findLatestWorkspace = async (args: {
  readonly baseDir: string;
  readonly projectId: string;
  readonly status?: WorkspaceStatus;
}): Promise<WorkspaceRecord | null> => {
  const xs = await listWorkspaces(args);
  return xs.length ? xs[0] : null;
};

export const findWorkspaceById = async (args: {
  readonly baseDir: string;
  readonly workspaceId: string;
  readonly projectId?: string;
}): Promise<WorkspaceRecord | null> => {
  // If projectId is known, load directly
  if (args.projectId) {
    try {
      return await loadWorkspace({
        baseDir: args.baseDir,
        projectId: args.projectId,
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
  readonly projectId: string;
  readonly workspaceId: string;
}): Promise<void> => {
  const p = workspaceFileFor(args.baseDir, args.projectId, args.workspaceId);
  await Deno.remove(p);
};

export const updateWorkspace = async (args: {
  readonly baseDir: string;
  readonly workspace: WorkspaceRecord;
  readonly updates: Partial<Pick<WorkspaceRecord, "status" | "name" | "contextPacks" | "flowsRun" | "archive">>;
}): Promise<WorkspaceRecord> => {
  const updated: WorkspaceRecord = {
    ...args.workspace,
    ...args.updates,
    updatedAt: isoNow(),
  };
  return await saveWorkspace({ baseDir: args.baseDir, workspace: updated });
};
