// Usage: pnpm import:sku <file.csv> [storeId=climax]
import fs from 'node:fs';
import { getDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { importRows, parseCsv } from './import.js';

const [file, storeId = 'climax'] = process.argv.slice(2);
if (!file) { console.error('usage: pnpm import:sku <file.csv> [storeId]'); process.exit(1); }

const db = await getDb();
await migrate(db);
const rows = parseCsv(fs.readFileSync(file, 'utf8'));
const res = await importRows(db, storeId, rows, `csv:${file}`);
console.log(JSON.stringify(res, null, 2));
await db.close();
