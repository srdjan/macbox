import { parseArgs } from "./mini_args.ts";
import { detectRepo } from "./git.ts";
import {
  addProject,
  findProjectByName,
  listProjects,
  removeProject,
} from "./project.ts";
import type { AgentKind } from "./agent.ts";
import type { Exit } from "./main.ts";
import { asString } from "./flags.ts";

export const projectCmd = async (argv: ReadonlyArray<string>): Promise<Exit> => {
  const a = parseArgs(argv);
  const sub = a._[0] as string | undefined;

  switch (sub) {
    case "add":
      return await projectAdd(a);
    case "list":
      return await projectList();
    case "show":
      return await projectShow(a);
    case "remove":
      return await projectRemove(a);
    default:
      console.log(`macbox project: add | list | show <name> | remove <name>`);
      return { code: sub ? 2 : 0 };
  }
};

const projectAdd = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const repoHint = asString(a.flags.repo);
  const name = asString(a.flags.name);
  const agentRaw = asString(a.flags.agent);
  const preset = asString(a.flags.preset);

  const agent: AgentKind | undefined =
    agentRaw === "claude" || agentRaw === "codex" || agentRaw === "custom"
      ? agentRaw
      : undefined;

  const repo = await detectRepo(repoHint);

  const entry = await addProject({
    repoPath: repo.root,
    name,
    defaultAgent: agent,
    defaultPreset: preset,
  });

  console.log(`macbox: registered project "${entry.name}" (${entry.projectId})`);
  console.log(`  path: ${entry.repoPath}`);
  return { code: 0 };
};

const projectList = async (): Promise<Exit> => {
  const projects = await listProjects();

  if (projects.length === 0) {
    console.log("macbox: no projects registered. Use 'macbox project add' to register one.");
    return { code: 0 };
  }

  const pad = (s: string, n: number) => s.padEnd(n);
  const maxName = Math.max(...projects.map((p) => p.name.length), 4);
  const maxId = 12;

  console.log(`${pad("NAME", maxName)}  ${pad("ID", maxId)}  PATH`);
  for (const p of projects) {
    console.log(`${pad(p.name, maxName)}  ${pad(p.projectId, maxId)}  ${p.repoPath}`);
  }
  return { code: 0 };
};

const projectShow = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const name = a._[1] as string | undefined;
  if (!name) {
    console.error("macbox project show: provide a project name or id");
    return { code: 2 };
  }

  const entry = await findProjectByName(name);
  if (!entry) {
    console.error(`macbox: project not found: ${name}`);
    return { code: 1 };
  }

  console.log(JSON.stringify(entry, null, 2));
  return { code: 0 };
};

const projectRemove = async (
  a: ReturnType<typeof parseArgs>,
): Promise<Exit> => {
  const name = a._[1] as string | undefined;
  if (!name) {
    console.error("macbox project remove: provide a project name or id");
    return { code: 2 };
  }

  const removed = await removeProject(name);
  console.log(`macbox: removed project "${removed.name}" (${removed.projectId})`);
  return { code: 0 };
};
