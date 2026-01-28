import { atomicWriteJson } from "./fs.ts";
import { pathJoin } from "./os.ts";
import { repoIdForRoot, projectRegistryPath } from "./paths.ts";
import type { AgentKind } from "./agent.ts";

export type ProjectEntry = {
  readonly projectId: string;
  readonly name: string;
  readonly repoPath: string;
  readonly defaultAgent?: AgentKind;
  readonly defaultPreset?: string;
  readonly defaultProfiles?: ReadonlyArray<string>;
  readonly preferredFlows?: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ProjectRegistry = {
  readonly schema: "macbox.projects.v1";
  readonly projects: ReadonlyArray<ProjectEntry>;
};

const isoNow = () => new Date().toISOString();

const emptyRegistry = (): ProjectRegistry => ({
  schema: "macbox.projects.v1",
  projects: [],
});

const isRegistry = (v: unknown): v is ProjectRegistry =>
  !!v && typeof v === "object" &&
  (v as Record<string, unknown>).schema === "macbox.projects.v1" &&
  Array.isArray((v as Record<string, unknown>).projects);

export const loadRegistry = async (): Promise<ProjectRegistry> => {
  const p = projectRegistryPath();
  try {
    const txt = await Deno.readTextFile(p);
    const j = JSON.parse(txt);
    if (!isRegistry(j)) return emptyRegistry();
    return j;
  } catch {
    return emptyRegistry();
  }
};

export const saveRegistry = async (reg: ProjectRegistry): Promise<void> => {
  const p = projectRegistryPath();
  await atomicWriteJson(p, reg);
};

export const addProject = async (args: {
  readonly repoPath: string;
  readonly name?: string;
  readonly defaultAgent?: AgentKind;
  readonly defaultPreset?: string;
  readonly defaultProfiles?: ReadonlyArray<string>;
  readonly preferredFlows?: ReadonlyArray<string>;
}): Promise<ProjectEntry> => {
  const reg = await loadRegistry();
  const projectId = await repoIdForRoot(args.repoPath);

  // Check if already registered
  const existing = reg.projects.find((p) => p.projectId === projectId);
  if (existing) {
    throw new Error(`macbox: project already registered: ${existing.name} (${existing.repoPath})`);
  }

  const name = args.name ?? args.repoPath.split("/").filter(Boolean).pop() ?? "unnamed";
  const now = isoNow();
  const entry: ProjectEntry = {
    projectId,
    name,
    repoPath: args.repoPath,
    defaultAgent: args.defaultAgent,
    defaultPreset: args.defaultPreset,
    defaultProfiles: args.defaultProfiles,
    preferredFlows: args.preferredFlows,
    createdAt: now,
    updatedAt: now,
  };

  const updated: ProjectRegistry = {
    ...reg,
    projects: [...reg.projects, entry],
  };
  await saveRegistry(updated);
  return entry;
};

export const removeProject = async (nameOrId: string): Promise<ProjectEntry> => {
  const reg = await loadRegistry();
  const match = reg.projects.find(
    (p) => p.name === nameOrId || p.projectId === nameOrId,
  );
  if (!match) {
    throw new Error(`macbox: project not found: ${nameOrId}`);
  }

  const updated: ProjectRegistry = {
    ...reg,
    projects: reg.projects.filter((p) => p.projectId !== match.projectId),
  };
  await saveRegistry(updated);
  return match;
};

export const findProjectByPath = async (repoPath: string): Promise<ProjectEntry | null> => {
  const reg = await loadRegistry();
  const projectId = await repoIdForRoot(repoPath);
  return reg.projects.find((p) => p.projectId === projectId) ?? null;
};

export const findProjectByName = async (name: string): Promise<ProjectEntry | null> => {
  const reg = await loadRegistry();
  return reg.projects.find((p) => p.name === name) ?? null;
};

export const listProjects = async (): Promise<ReadonlyArray<ProjectEntry>> => {
  const reg = await loadRegistry();
  return [...reg.projects].sort((a, b) => a.name.localeCompare(b.name));
};

export const findOrCreateProject = async (repoPath: string): Promise<ProjectEntry> => {
  const existing = await findProjectByPath(repoPath);
  if (existing) return existing;
  return await addProject({ repoPath });
};
