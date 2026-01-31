import { assert } from "./testutil.ts";
import {
  createWorkspace,
  deleteWorkspace,
  findLatestWorkspace,
  findWorkspaceById,
  listWorkspaces,
  loadWorkspace,
  updateWorkspace,
} from "../workspace.ts";

const withTempBase = async (fn: (baseDir: string) => Promise<void>) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "macbox-ws-test-" });
  try {
    await fn(tmpDir);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
};

Deno.test("createWorkspace creates valid record", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-test",
      worktreeName: "ws-test",
      worktreePath: "/tmp/wt/ws-test",
      name: "test workspace",
    });

    assert(ws.id.startsWith("ws-"), "expected ws- prefix");
    assert(ws.id.length === 11, "expected 11-char id (ws- + 8 hex)");
    assert(ws.repoId === "abc123def456", "expected repoId");
    assert(ws.sessionId === "abc123def456/ws-test", "expected sessionId");
    assert(ws.worktreeName === "ws-test", "expected worktreeName");
    assert(ws.name === "test workspace", "expected name");
    assert(ws.createdAt.length > 0, "expected createdAt");
    assert(ws.lastAccessedAt.length > 0, "expected lastAccessedAt");
  });
});

Deno.test("loadWorkspace reads persisted record", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-test",
      worktreeName: "ws-test",
      worktreePath: "/tmp/wt/ws-test",
    });

    const loaded = await loadWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      workspaceId: ws.id,
    });

    assert(loaded.id === ws.id, "expected matching id");
    assert(loaded.sessionId === ws.sessionId, "expected matching sessionId");
  });
});

Deno.test("listWorkspaces returns workspaces sorted by lastAccessedAt desc", async () => {
  await withTempBase(async (base) => {
    await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    // Small delay to ensure different lastAccessedAt
    await new Promise((r) => setTimeout(r, 10));

    await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-two",
      worktreeName: "ws-two",
      worktreePath: "/tmp/wt/ws-two",
    });

    const all = await listWorkspaces({ baseDir: base, repoId: "abc123def456" });
    assert(all.length === 2, "expected 2 workspaces");
    assert(all[0].worktreeName === "ws-two", "expected ws-two first (most recent)");
    assert(all[1].worktreeName === "ws-one", "expected ws-one second");
  });
});

Deno.test("findLatestWorkspace returns most recent", async () => {
  await withTempBase(async (base) => {
    await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    await new Promise((r) => setTimeout(r, 10));

    const second = await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-two",
      worktreeName: "ws-two",
      worktreePath: "/tmp/wt/ws-two",
    });

    const latest = await findLatestWorkspace({ baseDir: base, repoId: "abc123def456" });
    assert(latest !== null, "expected to find latest");
    assert(latest!.id === second.id, "expected second workspace as latest");
  });
});

Deno.test("findWorkspaceById searches across projects", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    // Search without repoId
    const found = await findWorkspaceById({ baseDir: base, workspaceId: ws.id });
    assert(found !== null, "expected to find workspace");
    assert(found!.id === ws.id, "expected matching id");

    const notFound = await findWorkspaceById({ baseDir: base, workspaceId: "ws-nonexistent" });
    assert(notFound === null, "expected null for unknown id");
  });
});

Deno.test("updateWorkspace changes name and updates lastAccessedAt", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
      name: "original name",
    });

    await new Promise((r) => setTimeout(r, 10));

    const updated = await updateWorkspace({
      baseDir: base,
      workspace: ws,
      updates: {
        name: "updated name",
      },
    });

    assert(updated.name === "updated name", "expected name updated");
    assert(updated.lastAccessedAt > ws.lastAccessedAt, "expected lastAccessedAt advanced");
  });
});

Deno.test("deleteWorkspace removes the file", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    await deleteWorkspace({
      baseDir: base,
      repoId: "abc123def456",
      workspaceId: ws.id,
    });

    const all = await listWorkspaces({ baseDir: base, repoId: "abc123def456" });
    assert(all.length === 0, "expected empty after delete");
  });
});

Deno.test("listWorkspaces returns empty when no workspaces dir", async () => {
  await withTempBase(async (base) => {
    const all = await listWorkspaces({ baseDir: base });
    assert(all.length === 0, "expected empty");
  });
});
