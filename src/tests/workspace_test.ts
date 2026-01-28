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
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-test",
      worktreeName: "ws-test",
      worktreePath: "/tmp/wt/ws-test",
      name: "test workspace",
      parent: { branch: "main", issue: 42 },
    });

    assert(ws.id.startsWith("ws-"), "expected ws- prefix");
    assert(ws.id.length === 11, "expected 11-char id (ws- + 8 hex)");
    assert(ws.projectId === "abc123def456", "expected projectId");
    assert(ws.sessionId === "abc123def456/ws-test", "expected sessionId");
    assert(ws.worktreeName === "ws-test", "expected worktreeName");
    assert(ws.status === "active", "expected active status");
    assert(ws.parent.branch === "main", "expected parent branch");
    assert(ws.parent.issue === 42, "expected parent issue");
    assert(ws.name === "test workspace", "expected name");
    assert(ws.contextPacks.length === 0, "expected empty contextPacks");
    assert(ws.flowsRun.length === 0, "expected empty flowsRun");
    assert(ws.createdAt.length > 0, "expected createdAt");
  });
});

Deno.test("loadWorkspace reads persisted record", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-test",
      worktreeName: "ws-test",
      worktreePath: "/tmp/wt/ws-test",
    });

    const loaded = await loadWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      workspaceId: ws.id,
    });

    assert(loaded.id === ws.id, "expected matching id");
    assert(loaded.sessionId === ws.sessionId, "expected matching sessionId");
  });
});

Deno.test("listWorkspaces returns workspaces sorted by updatedAt desc", async () => {
  await withTempBase(async (base) => {
    await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    // Small delay to ensure different updatedAt
    await new Promise((r) => setTimeout(r, 10));

    await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-two",
      worktreeName: "ws-two",
      worktreePath: "/tmp/wt/ws-two",
    });

    const all = await listWorkspaces({ baseDir: base, projectId: "abc123def456" });
    assert(all.length === 2, "expected 2 workspaces");
    assert(all[0].worktreeName === "ws-two", "expected ws-two first (most recent)");
    assert(all[1].worktreeName === "ws-one", "expected ws-one second");
  });
});

Deno.test("listWorkspaces filters by status", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    await updateWorkspace({
      baseDir: base,
      workspace: ws,
      updates: { status: "archived" },
    });

    await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-two",
      worktreeName: "ws-two",
      worktreePath: "/tmp/wt/ws-two",
    });

    const active = await listWorkspaces({ baseDir: base, projectId: "abc123def456", status: "active" });
    assert(active.length === 1, "expected 1 active workspace");
    assert(active[0].worktreeName === "ws-two", "expected ws-two active");

    const archived = await listWorkspaces({ baseDir: base, projectId: "abc123def456", status: "archived" });
    assert(archived.length === 1, "expected 1 archived workspace");
    assert(archived[0].worktreeName === "ws-one", "expected ws-one archived");
  });
});

Deno.test("findLatestWorkspace returns most recent", async () => {
  await withTempBase(async (base) => {
    await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    await new Promise((r) => setTimeout(r, 10));

    const second = await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-two",
      worktreeName: "ws-two",
      worktreePath: "/tmp/wt/ws-two",
    });

    const latest = await findLatestWorkspace({ baseDir: base, projectId: "abc123def456" });
    assert(latest !== null, "expected to find latest");
    assert(latest!.id === second.id, "expected second workspace as latest");
  });
});

Deno.test("findWorkspaceById searches across projects", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    // Search without projectId
    const found = await findWorkspaceById({ baseDir: base, workspaceId: ws.id });
    assert(found !== null, "expected to find workspace");
    assert(found!.id === ws.id, "expected matching id");

    const notFound = await findWorkspaceById({ baseDir: base, workspaceId: "ws-nonexistent" });
    assert(notFound === null, "expected null for unknown id");
  });
});

Deno.test("updateWorkspace changes status and preserves other fields", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
      name: "original name",
      parent: { branch: "main", issue: 42 },
    });

    const updated = await updateWorkspace({
      baseDir: base,
      workspace: ws,
      updates: {
        status: "archived",
        archive: {
          archivedAt: new Date().toISOString(),
          branchPointer: "macbox/ws-one",
          worktreeEvicted: false,
        },
      },
    });

    assert(updated.status === "archived", "expected archived status");
    assert(updated.archive !== undefined, "expected archive record");
    assert(updated.archive!.branchPointer === "macbox/ws-one", "expected branch pointer");
    assert(updated.name === "original name", "expected name preserved");
    assert(updated.parent.issue === 42, "expected issue preserved");
    assert(updated.updatedAt > ws.updatedAt, "expected updatedAt advanced");
  });
});

Deno.test("deleteWorkspace removes the file", async () => {
  await withTempBase(async (base) => {
    const ws = await createWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      sessionId: "abc123def456/ws-one",
      worktreeName: "ws-one",
      worktreePath: "/tmp/wt/ws-one",
    });

    await deleteWorkspace({
      baseDir: base,
      projectId: "abc123def456",
      workspaceId: ws.id,
    });

    const all = await listWorkspaces({ baseDir: base, projectId: "abc123def456" });
    assert(all.length === 0, "expected empty after delete");
  });
});

Deno.test("listWorkspaces returns empty when no workspaces dir", async () => {
  await withTempBase(async (base) => {
    const all = await listWorkspaces({ baseDir: base });
    assert(all.length === 0, "expected empty");
  });
});
