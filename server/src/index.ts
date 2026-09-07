import { getDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './api/server.js';
import { startScheduler } from './jobs/scheduler.js';

const db = await getDb();
const ran = await migrate(db);
if (ran.length) console.log('migrations applied:', ran.join(', '));

const app = buildServer(db);
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
startScheduler(db, process.env.STORE_ID ?? 'climax');
