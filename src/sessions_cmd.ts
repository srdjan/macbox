import { parseArgs } from "./mini_args.ts";
import { detectRepo } from "./git.ts";
import { defaultBaseDir } from "./paths.ts";
import {
  deleteAllSessions,
  deleteSession,
  findLatestSession,
  listSessions,
  loadSessionById,
  resolveSessionIdForRepo,
} from "./sessions.ts";
import { boolFlag, requireStringFlag } from "./flags.ts";

export const sessionsCmd = async (argv: ReadonlyArray<string>) => {
  const usage = () => {
    console.log(
      [
        "macbox sessions - inspect and manage saved session records",
        "",
        "Usage:",
        "  macbox sessions list [--json] [--repo <path>] [--base <path>]",
        "  macbox sessions show <id|worktreeName|latest> [--json] [--repo <path>] [--base <path>]",
        "  macbox sessions delete <id|worktreeName> [--json] [--repo <path>] [--base <path>]",
        "  macbox sessions clean [--json] [--all] [--repo <path>] [--base <path>]",
      ].join("\n"),
    );
  };

  const a = parseArgs(argv);
  const base = requireStringFlag("base", a.flags.base) ?? defaultBaseDir();
  const repoHint = requireStringFlag("repo", a.flags.repo);
  const json = boolFlag(a.flags.json, false);

  const [sub, ...rest] = a._;

  if (!sub || sub === "help" || a.flags.help) {
    usage();
    return { code: 0 };
  }

  switch (sub) {
    case "list": {
      const repo = repoHint ? await detectRepo(repoHint) : null;
      const xs = await listSessions({ baseDir: base, repoRoot: repo?.root });
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.sessions.list.v1",
            sessions: xs,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      if (xs.length === 0) {
        console.log("No sessions.");
        return { code: 0 };
      }
      // plain columns
      console.log(["ID", "AGENT", "WORKTREE", "UPDATED"].join("\t"));
      for (const s of xs) {
        console.log(
          [s.id, s.agent ?? "-", s.worktreeName, s.updatedAt].join("\t"),
        );
      }
      return { code: 0 };
    }
    case "show": {
      const idArg = rest[0];
      if (!idArg) {
        throw new Error(
          "sessions show: missing <id>. Use: macbox sessions list",
        );
      }
      // If id is "latest" and repo is provided, resolve within repo; otherwise global latest.
      if (idArg === "latest") {
        const repo = repoHint ? await detectRepo(repoHint) : null;
        const s = await findLatestSession({
          baseDir: base,
          repoRoot: repo?.root,
        });
        if (!s) throw new Error("macbox: no sessions found (latest)");
        if (json) {
          console.log(JSON.stringify(
            {
              schema: "macbox.sessions.show.v1",
              session: s,
            },
            null,
            2,
          ));
          return { code: 0 };
        }
        console.log(JSON.stringify(s, null, 2));
        return { code: 0 };
      }
      if (!idArg.includes("/")) {
        const repo = await detectRepo(repoHint);
        const resolved = await resolveSessionIdForRepo({
          baseDir: base,
          repoRoot: repo.root,
          ref: idArg,
        });
        const s = await loadSessionById({ baseDir: base, id: resolved });
        if (json) {
          console.log(JSON.stringify(
            {
              schema: "macbox.sessions.show.v1",
              session: s,
            },
            null,
            2,
          ));
          return { code: 0 };
        }
        console.log(JSON.stringify(s, null, 2));
        return { code: 0 };
      }
      const s = await loadSessionById({ baseDir: base, id: idArg });
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.sessions.show.v1",
            session: s,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      console.log(JSON.stringify(s, null, 2));
      return { code: 0 };
    }
    case "clean": {
      const all = !!a.flags.all;
      if (all) {
        await deleteAllSessions({ baseDir: base });
        if (json) {
          console.log(JSON.stringify(
            {
              schema: "macbox.sessions.clean.v1",
              mode: "all",
            },
            null,
            2,
          ));
          return { code: 0 };
        }
        console.log("Deleted all sessions.");
        return { code: 0 };
      }
      // default: delete sessions for current repo
      const repo = await detectRepo(repoHint);
      await deleteAllSessions({ baseDir: base, repoRoot: repo.root });
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.sessions.clean.v1",
            mode: "repo",
            repoRoot: repo.root,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      console.log("Deleted sessions for this repo.");
      return { code: 0 };
    }
    case "delete": {
      const idArg = rest[0];
      if (!idArg) throw new Error("sessions delete: missing <id>.");
      let id = idArg;
      if (!idArg.includes("/")) {
        const repo = await detectRepo(repoHint);
        id = await resolveSessionIdForRepo({
          baseDir: base,
          repoRoot: repo.root,
          ref: idArg,
        });
      }
      await deleteSession({ baseDir: base, id });
      if (json) {
        console.log(JSON.stringify(
          {
            schema: "macbox.sessions.delete.v1",
            id,
          },
          null,
          2,
        ));
        return { code: 0 };
      }
      console.log(`Deleted session: ${id}`);
      return { code: 0 };
    }
    default:
      usage();
      return { code: 2 };
  }
};
