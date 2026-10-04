import { describe, expect, it, vi } from "vitest";

const closed: string[] = [];
vi.mock("bullmq", () => ({
  Queue: class { async close() { closed.push("queue"); } },
  Worker: class { on() { return this; } async close() { closed.push("worker"); } },
}));

const { createAnalysisQueue, createAnalysisWorker } = await import("./queue.js");

function fakeRedis(name: string) {
  return { duplicate: () => ({ quit: vi.fn(async () => { closed.push(`${name} connection`); }) }) };
}

describe("queue shutdown", () => {
  it("closes the queue's own Redis connection after the queue, so a stopped process can exit", async () => {
    closed.length = 0;
    await createAnalysisQueue(fakeRedis("queue")).close();
    expect(closed).toEqual(["queue", "queue connection"]);
  });

  it("closes the worker's own Redis connection only after the worker has finished closing", async () => {
    closed.length = 0;
    await createAnalysisWorker(fakeRedis("worker"), {} as never).close();
    expect(closed).toEqual(["worker", "worker connection"]);
  });
});
