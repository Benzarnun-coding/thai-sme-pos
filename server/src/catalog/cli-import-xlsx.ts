// Usage: pnpm import:xlsx <LOCATION_SKU.xlsx | bigseller-spu.xlsx> [location=all] [storeId=climax]
import { getDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { importRows } from './import.js';
import { readWorkbook } from './import-xlsx.js';

const [file, location = 'all', storeId = 'climax'] = process.argv.slice(2);
if (!file) { console.error('usage: pnpm import:xlsx <file.xlsx> [location|all] [storeId]'); process.exit(1); }

const parsed = readWorkbook(file, { location: location === 'all' ? undefined : location });
console.log(`format: ${parsed.format} · tabs: ${parsed.sheets.join(', ')} · SKU rows: ${parsed.rows.length}`);
if (parsed.warnings.length) { console.log(`คำเตือน (${parsed.warnings.length}):`); parsed.warnings.slice(0, 30).forEach((w) => console.log(' -', w)); }

const db = await getDb();
await migrate(db);
const res = await importRows(db, storeId, parsed.rows, `xlsx:${file}:${location}`);
console.log(JSON.stringify(res, null, 2));
await db.close();
