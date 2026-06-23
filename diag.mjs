import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// REPLICATE_WEBHOOK_SECRET is empty, so the webhook endpoint is fail-closed (returns 401).
// This means the ONLY path to process async jobs is the cron poll-predictions.
// But the cron couldn't find job 990001 even though it was in sam2_processing.

// Let me check job 960001 more carefully - how did it complete?
const [job960] = await conn.execute(
  'SELECT id, status, predictionId, enqueuedAt, createdAt, updatedAt, errorMessage FROM studio_jobs WHERE id = 960001'
);
console.log('Job 960001:', JSON.stringify(job960[0], null, 2));

// Check if there are ANY logs related to job 960001 completing
const [logs960] = await conn.execute(
  "SELECT id, level, source, message, createdAt FROM server_logs WHERE message LIKE '%960001%' ORDER BY createdAt ASC"
);
console.log('\nLogs mentioning 960001:');
for (const r of logs960) console.log(r.createdAt, r.level, r.source, r.message);

// Check all studio-related logs around 22:24-22:36 (job 960001 lifetime)
const [studioLogs] = await conn.execute(
  "SELECT id, level, source, message, createdAt FROM server_logs WHERE source = 'studio' AND createdAt >= '2026-06-22 22:24:00' AND createdAt <= '2026-06-22 22:36:00' ORDER BY createdAt ASC"
);
console.log('\nStudio logs 22:24-22:36:');
for (const r of studioLogs) console.log(r.createdAt, r.level, r.source, r.message);

await conn.end();
process.exit(0);
