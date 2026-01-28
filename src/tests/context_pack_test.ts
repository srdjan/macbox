import { assert } from "./testutil.ts";
import {
  createContextPack,
  listContextPacks,
  loadContextPack,
  contextPackDir,
} from "../context_pack.ts";
import { pathJoin } from "../os.ts";
import { exec } from "../exec.ts";

const withTempGitRepo = async (fn: (dir: string) => Promise<void>) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "macbox-ctx-test-" });
  // Initialize a git repo
  await exec(["git", "init"], { cwd: tmpDir, quiet: true });
  await exec(["git", "config", "user.email", "test@test.com"], { cwd: tmpDir, quiet: true });
  await exec(["git", "config", "user.name", "Test"], { cwd: tmpDir, quiet: true });
  // Create initial commit
  await Deno.writeTextFile(pathJoin(tmpDir, "README.md"), "# Test\n");
  await exec(["git", "add", "."], { cwd: tmpDir, quiet: true });
  await exec(["git", "commit", "-m", "initial"], { cwd: tmpDir, quiet: true });
  // Create .macbox dir
  await Deno.mkdir(pathJoin(tmpDir, ".macbox"), { recursive: true });
  try {
    await fn(tmpDir);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
};

Deno.test("createContextPack captures git state", async () => {
  await withTempGitRepo(async (dir) => {
    const pack = await createContextPack({ worktreePath: dir });

    assert(pack.packId.startsWith("pack-"), "expected pack- prefix");
    assert(pack.packId.length === 13, "expected 13-char id (pack- + 8 hex)");
    assert(pack.createdAt.length > 0, "expected createdAt");
    assert(pack.repoState.commitSha.length === 40, "expected 40-char SHA");
    assert(pack.repoState.dirty === false, "expected clean state");
    assert(pack.repoState.untrackedCount === 0, "expected no untracked");
  });
});

Deno.test("createContextPack detects dirty state", async () => {
  await withTempGitRepo(async (dir) => {
    // Make a modification
    await Deno.writeTextFile(pathJoin(dir, "README.md"), "# Modified\n");

    const pack = await createContextPack({ worktreePath: dir });
    assert(pack.repoState.dirty === true, "expected dirty");
    assert(pack.repoState.modifiedFiles.length > 0, "expected modified files");
  });
});

Deno.test("createContextPack writes all expected files", async () => {
  await withTempGitRepo(async (dir) => {
    // Make a change to get a diff
    await Deno.writeTextFile(pathJoin(dir, "README.md"), "# Changed\n");

    const pack = await createContextPack({
      worktreePath: dir,
      summary: "Test summary",
      notes: "Test notes",
    });

    const packPath = contextPackDir(dir, pack.packId);

    // Verify all files exist
    const files = ["pack.json", "repo_state.json", "diff.patch", "summary.md", "notes.md", "commands.log"];
    for (const f of files) {
      const stat = await Deno.stat(pathJoin(packPath, f));
      assert(stat.isFile, `expected ${f} to exist`);
    }

    // Verify content
    const summaryContent = await Deno.readTextFile(pathJoin(packPath, "summary.md"));
    assert(summaryContent === "Test summary", "expected custom summary");

    const notesContent = await Deno.readTextFile(pathJoin(packPath, "notes.md"));
    assert(notesContent === "Test notes", "expected custom notes");

    const diffContent = await Deno.readTextFile(pathJoin(packPath, "diff.patch"));
    assert(diffContent.includes("Changed"), "expected diff to contain change");
  });
});

Deno.test("loadContextPack reads persisted pack", async () => {
  await withTempGitRepo(async (dir) => {
    const pack = await createContextPack({ worktreePath: dir });
    const loaded = await loadContextPack(dir, pack.packId);

    assert(loaded.packId === pack.packId, "expected matching packId");
    assert(loaded.repoState.commitSha === pack.repoState.commitSha, "expected matching SHA");
  });
});

Deno.test("listContextPacks returns sorted packs", async () => {
  await withTempGitRepo(async (dir) => {
    const pack1 = await createContextPack({ worktreePath: dir });
    await new Promise((r) => setTimeout(r, 10));
    const pack2 = await createContextPack({ worktreePath: dir });

    const packs = await listContextPacks(dir);
    assert(packs.length === 2, "expected 2 packs");
    // Most recent first
    assert(packs[0].packId === pack2.packId, "expected pack2 first");
    assert(packs[1].packId === pack1.packId, "expected pack1 second");
  });
});

Deno.test("listContextPacks returns empty when no packs", async () => {
  await withTempGitRepo(async (dir) => {
    const packs = await listContextPacks(dir);
    assert(packs.length === 0, "expected empty");
  });
});

Deno.test("createContextPack with workspaceId", async () => {
  await withTempGitRepo(async (dir) => {
    const pack = await createContextPack({
      worktreePath: dir,
      workspaceId: "ws-abc12345",
    });

    assert(pack.workspaceId === "ws-abc12345", "expected workspaceId");
    const loaded = await loadContextPack(dir, pack.packId);
    assert(loaded.workspaceId === "ws-abc12345", "expected workspaceId persisted");
  });
});
