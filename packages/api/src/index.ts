import { config } from './config.js';
import { build } from './server.js';
import { startJobs } from './jobs/index.js';
import { closeDb } from './db/client.js';

const c = config();
const app = await build();
await app.listen({ port: c.PORT, host: c.HOST });
startJobs();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
