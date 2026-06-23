import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Job 960001 completed at 22:35:36, 11 minutes after enqueue at 22:24:55.
// No studio logs, no cron success, no webhook. How?
//
// WAIT - the SSE stream endpoint! The code at line 232-300 shows:
// If ENV.studioAsyncJobs is OFF, it returns { async: true } and the CLIENT opens
// the SSE stream endpoint which does the actual work.
// If ENV.studioAsyncJobs is ON, it does the deduct+startPrediction+markJobEnqueued flow.
//
// But there's also the SSE stream endpoint itself. Let me check if it also processes
// async jobs or if it's a separate path.

// Actually, looking more carefully at the code:
// Line 232-239: "R1: density/scale deterministic ops are handled exclusively by the SSE
// streaming endpoint (/api/studio/generate-stream)"
// Line 245: "if (ENV.studioAsyncJobs)" -> async path
// Line 293: else -> return { async: true } (the SSE path)
//
// So when STUDIO_ASYNC_JOBS is OFF, the generate mutation returns async:true and the
// CLIENT opens the SSE stream which does the work synchronously (keeping the connection alive).
//
// But when STUDIO_ASYNC_JOBS is ON, the generate mutation does the enqueue and returns.
// The client then polls via useAsyncGenerate (every 2s, read-only).
//
// For job 960001: it completed at 22:35, 11 min after enqueue.
// The cron was failing auth at that time.
// No webhook (secret is empty).
// 
// HYPOTHESIS: Maybe STUDIO_ASYNC_JOBS was OFF when job 960001 was created,
// and the SSE stream handled it. Then it was turned ON for job 990001.
//
// Let me check: when was STUDIO_ASYNC_JOBS set to true?
// The job 960001 has predictionId and enqueuedAt set, which means markJobEnqueued was called.
// markJobEnqueued is ONLY called in the async path (ENV.studioAsyncJobs=true).
// So STUDIO_ASYNC_JOBS was already ON for job 960001.
//
// Then how did job 960001 complete?
// 
// NEW THEORY: The SSE stream endpoint ALSO processes async jobs.
// When the client opens the stream for a job that's in sam2_processing,
// it might poll Replicate and complete the job.

// Let me check the studioStream route
const [allLogs] = await conn.execute(
  "SELECT id, level, source, message, createdAt FROM server_logs WHERE createdAt >= '2026-06-22 22:34:00' AND createdAt <= '2026-06-22 22:37:00' ORDER BY createdAt ASC"
);
console.log('All logs 22:34-22:37:');
for (const r of allLogs) console.log(r.createdAt, r.level, r.source, r.message.substring(0, 120));

// Check the generate-stream route
console.log('\n--- Checking if stream endpoint handles async jobs ---');

await conn.end();
process.exit(0);
