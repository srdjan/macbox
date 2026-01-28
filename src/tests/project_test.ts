import { assert } from "./testutil.ts";
import {
  addProject,
  findProjectByName,
  findProjectByPath,
  listProjects,
  loadRegistry,
  removeProject,
  saveRegistry,
} from "../project.ts";
import { repoIdForRoot, projectRegistryPath } from "../paths.ts";

// Override the registry path for testing by using a temp config dir
const withTempEnv = async (fn: () => Promise<void>) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "macbox-test-" });
  const origHome = Deno.env.get("HOME");
  Deno.env.set("HOME", tmpDir);
  try {
    await fn();
  } finally {
    if (origHome) Deno.env.set("HOME", origHome);
    else Deno.env.delete("HOME");
    await Deno.remove(tmpDir, { recursive: true });
  }
};

Deno.test("loadRegistry returns empty when no file exists", async () => {
  await withTempEnv(async () => {
    const reg = await loadRegistry();
    assert(reg.schema === "macbox.projects.v1", "expected schema v1");
    assert(reg.projects.length === 0, "expected empty projects");
  });
});

Deno.test("addProject creates entry and persists", async () => {
  await withTempEnv(async () => {
    const entry = await addProject({
      repoPath: "/tmp/test-repo",
      name: "test-repo",
    });

    assert(entry.name === "test-repo", "expected name");
    assert(entry.repoPath === "/tmp/test-repo", "expected repoPath");
    assert(entry.projectId.length === 12, "expected 12-char id");
    assert(entry.createdAt.length > 0, "expected createdAt");

    // Verify persisted
    const reg = await loadRegistry();
    assert(reg.projects.length === 1, "expected 1 project");
    assert(reg.projects[0].name === "test-repo", "expected persisted name");
  });
});

Deno.test("addProject rejects duplicates", async () => {
  await withTempEnv(async () => {
    await addProject({ repoPath: "/tmp/test-repo", name: "first" });

    let threw = false;
    try {
      await addProject({ repoPath: "/tmp/test-repo", name: "second" });
    } catch (e) {
      threw = true;
      assert(
        (e as Error).message.includes("already registered"),
        "expected already registered error",
      );
    }
    assert(threw, "expected error on duplicate");
  });
});

Deno.test("findProjectByPath returns matching project", async () => {
  await withTempEnv(async () => {
    await addProject({ repoPath: "/tmp/test-repo", name: "my-proj" });

    const found = await findProjectByPath("/tmp/test-repo");
    assert(found !== null, "expected to find project");
    assert(found!.name === "my-proj", "expected name match");

    const notFound = await findProjectByPath("/tmp/other-repo");
    assert(notFound === null, "expected null for unknown path");
  });
});

Deno.test("findProjectByName returns matching project", async () => {
  await withTempEnv(async () => {
    await addProject({ repoPath: "/tmp/test-repo", name: "my-proj" });

    const found = await findProjectByName("my-proj");
    assert(found !== null, "expected to find project");
    assert(found!.repoPath === "/tmp/test-repo", "expected path match");

    const notFound = await findProjectByName("nope");
    assert(notFound === null, "expected null for unknown name");
  });
});

Deno.test("removeProject removes by name", async () => {
  await withTempEnv(async () => {
    await addProject({ repoPath: "/tmp/test-repo", name: "my-proj" });
    const removed = await removeProject("my-proj");
    assert(removed.name === "my-proj", "expected removed name");

    const reg = await loadRegistry();
    assert(reg.projects.length === 0, "expected empty after remove");
  });
});

Deno.test("removeProject removes by id", async () => {
  await withTempEnv(async () => {
    const entry = await addProject({ repoPath: "/tmp/test-repo", name: "my-proj" });
    await removeProject(entry.projectId);

    const reg = await loadRegistry();
    assert(reg.projects.length === 0, "expected empty after remove by id");
  });
});

Deno.test("listProjects returns sorted list", async () => {
  await withTempEnv(async () => {
    await addProject({ repoPath: "/tmp/bbb", name: "bravo" });
    await addProject({ repoPath: "/tmp/aaa", name: "alpha" });

    const list = await listProjects();
    assert(list.length === 2, "expected 2 projects");
    assert(list[0].name === "alpha", "expected alpha first (sorted)");
    assert(list[1].name === "bravo", "expected bravo second (sorted)");
  });
});

Deno.test("projectId matches repoIdForRoot", async () => {
  await withTempEnv(async () => {
    const entry = await addProject({ repoPath: "/tmp/test-repo" });
    const expectedId = await repoIdForRoot("/tmp/test-repo");
    assert(entry.projectId === expectedId, "projectId should match repoIdForRoot");
  });
});

Deno.test("addProject derives name from path basename", async () => {
  await withTempEnv(async () => {
    const entry = await addProject({ repoPath: "/Users/dev/my-cool-project" });
    assert(entry.name === "my-cool-project", "expected basename as name");
  });
});
