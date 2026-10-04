import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";
import type { PreMortemEngine } from "./engine.js";

const QUEUE = "premortem-analysis";
const JobData = z.object({ analysisRunId: z.string().uuid() }).strict();

type QueueConnection = { quit: () => Promise<unknown> };
type QueueRedis = { duplicate: () => QueueConnection };

export function createAnalysisQueue(redis: QueueRedis) {
  // BullMQ never closes a connection it was handed, so this module owns and closes its duplicates;
  // otherwise their sockets keep the process alive after a graceful shutdown.
  const connection = redis.duplicate();
  const queue = new Queue(QUEUE, { connection: connection as any });
  return {
    async enqueue(analysisRunId: string) {
      await queue.add("run-analysis", { analysisRunId }, {
        jobId: analysisRunId,
        // Provider calls have a narrow, call-level retry. Retrying the whole job would
        // duplicate completed Gemini stages and can exceed its 20-request free quota.
        attempts: 1,
        removeOnComplete: 200,
        removeOnFail: 500,
      });
    },
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createAnalysisWorker(redis: QueueRedis, engine: PreMortemEngine) {
  const connection = redis.duplicate();
  const worker = new Worker(QUEUE, async (job: Job) => {
    const { analysisRunId } = JobData.parse(job.data);
    await engine.run(analysisRunId);
  }, { connection: connection as any, concurrency: 1, lockDuration: 90_000 });
  return {
    on: worker.on.bind(worker),
    /** Waits for the active job to finish, then closes the worker's own Redis connection. */
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}

export type AnalysisQueue = ReturnType<typeof createAnalysisQueue>;
