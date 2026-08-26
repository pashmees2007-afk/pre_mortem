import { createApp } from "./app.js";
import { createContainer } from "./container.js";

const container = createContainer();
const app = createApp(container);
const server = app.listen(container.config.PORT, () => {
  console.log(`Pre-Mortem API listening on port ${container.config.PORT}`);
});

async function shutdown() {
  server.close();
  await Promise.all([container.queue.close(), container.redis.quit(), container.pool.end()]);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
