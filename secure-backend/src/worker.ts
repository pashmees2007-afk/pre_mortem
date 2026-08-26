import { createContainer } from "./container.js";
import { createAnalysisWorker } from "./queue.js";

const container = createContainer();
const worker = createAnalysisWorker(container.redis, container.engine);
worker.on("failed", (job, error) => console.error({ jobId: job?.id, error: error.message }, "Analysis job failed"));
worker.on("error", (error) => console.error({ error: error.message }, "Analysis worker error"));

async function shutdown() {
  await worker.close();
  await Promise.all([container.queue.close(), container.redis.quit(), container.pool.end()]);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
