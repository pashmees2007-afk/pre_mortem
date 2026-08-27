import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";
import type { PreMortemEngine } from "./engine.js";

const QUEUE = "premortem-analysis";
const JobData = z.object({ analysisRunId: z.string().uuid() }).strict();

type QueueRedis = { duplicate: () => unknown };

export function createAnalysisQueue(redis: QueueRedis) {
  const queue = new Queue(QUEUE, { connection: redis.duplicate() as any });
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
    async close() { await queue.close(); },
  };
}

export function createAnalysisWorker(redis: QueueRedis, engine: PreMortemEngine) {
  return new Worker(QUEUE, async (job: Job) => {
    const { analysisRunId } = JobData.parse(job.data);
    await engine.run(analysisRunId);
  }, { connection: redis.duplicate() as any, concurrency: 1, lockDuration: 90_000 });
}

export type AnalysisQueue = ReturnType<typeof createAnalysisQueue>;
