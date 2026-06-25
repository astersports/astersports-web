import { ENV } from "./env";

/**
 * In-process cron scheduler — replaces the Manus Heartbeat external scheduler.
 * On the running app it fires the existing /api/scheduled/* endpoints on fixed
 * intervals via localhost self-HTTP, authenticating with CRON_SECRET (the same
 * gate any external caller would use). Self-HTTP (rather than calling the handler
 * functions directly) keeps each endpoint the single execution path — the
 * money-path poll/reaper handlers are untouched.
 *
 * Idempotency-safe: the underlying jobs (atomic job-claim CAS, refund-once
 * reaper, ON CONFLICT billing) tolerate an occasional duplicate run, so this is
 * safe even if more than one instance ever has the scheduler enabled.
 */

type ScheduledJob = {
  name: string;
  path: string;
  intervalMs: number;
};

const MIN = 60_000;
const HOUR = 60 * MIN;

const JOBS: ScheduledJob[] = [
  // Studio async pipeline (money path): poll Replicate + process ready jobs.
  { name: "poll-predictions", path: "/api/scheduled/poll-predictions", intervalMs: 1 * MIN },
  // Refund + fail jobs stranded past 10 min (never bill for a no-op).
  { name: "reap-stuck-jobs", path: "/api/scheduled/reap-stuck-jobs", intervalMs: 5 * MIN },
  // Legacy sports highlight notifications.
  { name: "game-check", path: "/api/scheduled/game-check", intervalMs: 2 * MIN },
  // Daily maintenance + trial lifecycle.
  { name: "log-cleanup", path: "/api/scheduled/log-cleanup", intervalMs: 24 * HOUR },
  { name: "trial-reminders", path: "/api/scheduled/trial-reminders", intervalMs: 24 * HOUR },
  { name: "trial-autocharge", path: "/api/scheduled/trial-autocharge", intervalMs: 24 * HOUR },
];

let timers: ReturnType<typeof setInterval>[] = [];

async function triggerJob(job: ScheduledJob, baseUrl: string): Promise<void> {
  try {
    const resp = await fetch(`${baseUrl}${job.path}`, {
      method: "POST",
      headers: { "x-cron-secret": ENV.cronSecret, "content-type": "application/json" },
    });
    if (!resp.ok) {
      console.warn(`[scheduler] ${job.name} returned HTTP ${resp.status}`);
    }
  } catch (err) {
    // A transient failure must never crash the host process — log and let the
    // next tick retry.
    console.warn(`[scheduler] ${job.name} failed: ${String(err)}`);
  }
}

/** Start the interval timers. No-op unless ENABLE_SCHEDULER=true and CRON_SECRET is set. */
export function startScheduler(port: number): void {
  if (!ENV.schedulerEnabled) {
    console.log("[scheduler] ENABLE_SCHEDULER not set — in-process crons disabled");
    return;
  }
  if (!ENV.cronSecret) {
    console.error("[scheduler] refusing to start: CRON_SECRET is not set (the /api/scheduled gate)");
    return;
  }
  stopScheduler(); // idempotent: never double-register on a re-init

  const baseUrl = `http://127.0.0.1:${port}`;
  for (const job of JOBS) {
    const timer = setInterval(() => {
      void triggerJob(job, baseUrl);
    }, job.intervalMs);
    // Don't let the timers alone keep the process alive (the HTTP server does).
    if (typeof timer.unref === "function") timer.unref();
    timers.push(timer);
  }
  console.log(`[scheduler] started ${JOBS.length} in-process cron jobs on ${baseUrl}`);
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}

/** Exposed for tests. */
export const SCHEDULED_JOBS = JOBS;
