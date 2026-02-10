import { parseArgs } from "./mini_args.ts";
import { detectRepo } from "./git.ts";
import { defaultBaseDir } from "./paths.ts";
import { findLatestSession, listSessions, loadSessionById, resolveSessionIdForRepo, deleteAllSessions, deleteSession } from "./sessions.ts";
import { asString } from "./flags.ts";

export const sessionsCmd = async (argv: ReadonlyArray<string>) => {
  const usage = () => {
    console.log(
      [
        "macbox sessions - inspect and manage saved session records",
        "",
        "Usage:",
        "  macbox sessions list [--repo <path>] [--base <path>]",
        "  macbox sessions show <id|worktreeName|latest> [--repo <path>] [--base <path>]",
        "  macbox sessions delete <id|worktreeName> [--repo <path>] [--base <path>]",
        "  macbox sessions clean [--all] [--repo <path>] [--base <path>]",
      ].join("\n"),
    );
  };

  const a = parseArgs(argv);
  const base = asString(a.flags.base) ?? defaultBaseDir();
  const repoHint = asString(a.flags.repo);

  const [sub, ...rest] = a._;

  if (!sub || sub === "help" || a.flags.help) {
    usage();
    return { code: 0 };
  }

  switch (sub) {
    case "list": {
      const repo = repoHint ? await detectRepo(repoHint) : null;
      const xs = await listSessions({ baseDir: base, repoRoot: repo?.root });
      if (xs.length === 0) {
        console.log("No sessions.");
        return { code: 0 };
      }
      // plain columns
      console.log(["ID", "AGENT", "WORKTREE", "UPDATED"].join("\t"));
      for (const s of xs) {
        console.log([s.id, s.agent ?? "-", s.worktreeName, s.updatedAt].join("\t"));
      }
      return { code: 0 };
    }
    case "show": {
      const idArg = rest[0];
      if (!idArg) throw new Error("sessions show: missing <id>. Use: macbox sessions list");
      // If id is "latest" and repo is provided, resolve within repo; otherwise global latest.
      if (idArg === "latest") {
        const repo = repoHint ? await detectRepo(repoHint) : null;
        const s = await findLatestSession({ baseDir: base, repoRoot: repo?.root });
        if (!s) throw new Error("macbox: no sessions found (latest)");
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
        console.log(JSON.stringify(s, null, 2));
        return { code: 0 };
      }
      const s = await loadSessionById({ baseDir: base, id: idArg });
      console.log(JSON.stringify(s, null, 2));
      return { code: 0 };
    }
    case "clean": {
      const all = !!a.flags.all;
      if (all) {
        await deleteAllSessions({ baseDir: base });
        console.log("Deleted all sessions.");
        return { code: 0 };
      }
      // default: delete sessions for current repo
      const repo = await detectRepo(repoHint);
      await deleteAllSessions({ baseDir: base, repoRoot: repo.root });
      console.log("Deleted sessions for this repo.");
      return { code: 0 };
    }
    case "delete": {
      const idArg = rest[0];
      if (!idArg) throw new Error("sessions delete: missing <id>.");
      let id = idArg;
      if (!idArg.includes("/")) {
        const repo = await detectRepo(repoHint);
        id = await resolveSessionIdForRepo({ baseDir: base, repoRoot: repo.root, ref: idArg });
      }
      await deleteSession({ baseDir: base, id });
      console.log(`Deleted session: ${id}`);
      return { code: 0 };
    }
    default:
      usage();
      return { code: 2 };
  }
};
