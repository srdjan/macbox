import { assert } from "./testutil.ts";
import { runWithLimit } from "../swarm.ts";

Deno.test("runWithLimit executes all tasks", async () => {
  const results: number[] = [];
  const tasks = [1, 2, 3, 4, 5].map((n) => async () => {
    results.push(n);
    return n * 10;
  });

  const out = await runWithLimit(tasks, 3);
  assert(out.length === 5, "expected 5 results");
  assert(out[0] === 10, "expected first result 10");
  assert(out[4] === 50, "expected last result 50");
  assert(results.length === 5, "expected all tasks ran");
});

Deno.test("runWithLimit respects concurrency limit", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;

  const tasks = Array.from({ length: 6 }, (_, i) => async () => {
    concurrent++;
    if (concurrent > maxConcurrent) maxConcurrent = concurrent;
    // Small delay to allow overlap detection
    await new Promise((r) => setTimeout(r, 10));
    concurrent--;
    return i;
  });

  const out = await runWithLimit(tasks, 2);
  assert(out.length === 6, "expected 6 results");
  assert(maxConcurrent <= 2, `expected max concurrency <= 2, got ${maxConcurrent}`);
});

Deno.test("runWithLimit handles single task", async () => {
  const out = await runWithLimit([async () => 42], 5);
  assert(out.length === 1, "expected 1 result");
  assert(out[0] === 42, "expected 42");
});

Deno.test("runWithLimit handles empty task list", async () => {
  const out = await runWithLimit([], 3);
  assert(out.length === 0, "expected 0 results");
});

Deno.test("runWithLimit preserves result order", async () => {
  // Tasks complete at different speeds but results should be in input order
  const tasks = [3, 1, 2].map((delay) => async () => {
    await new Promise((r) => setTimeout(r, delay * 5));
    return delay;
  });

  const out = await runWithLimit(tasks, 3);
  assert(out[0] === 3, "expected first result 3 (slowest task)");
  assert(out[1] === 1, "expected second result 1");
  assert(out[2] === 2, "expected third result 2");
});

Deno.test("runWithLimit limit=1 runs sequentially", async () => {
  const order: number[] = [];
  const tasks = [1, 2, 3].map((n) => async () => {
    order.push(n);
    return n;
  });

  const out = await runWithLimit(tasks, 1);
  assert(out.length === 3, "expected 3 results");
  // With limit=1, execution must be strictly sequential
  assert(order[0] === 1 && order[1] === 2 && order[2] === 3, "expected sequential order");
});

Deno.test("runWithLimit propagates task errors", async () => {
  const tasks = [
    async () => 1,
    async () => { throw new Error("task failed"); },
    async () => 3,
  ];

  let caught = false;
  try {
    await runWithLimit(tasks, 2);
  } catch (err) {
    caught = true;
    assert(err instanceof Error, "expected Error");
    assert((err as Error).message === "task failed", "expected 'task failed'");
  }
  assert(caught, "expected error to propagate");
});
