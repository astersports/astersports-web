/**
 * useAsyncGenerate (ASYNC_GENERATION_SPEC §4 client) — polls studio.getJob while an async
 * density/scale job runs and fires terminal callbacks exactly once.
 *
 * - Polls every 2s ONLY while the job is active (pending / sam2_processing / cpu_processing).
 * - Stops the instant the job hits a terminal state (refetchInterval -> false) so there is no
 *   infinite polling loop.
 * - On `done`: pulls the resultUrl from the latest variation -> onDone.
 * - On `failed`: -> onFailed (the worker has already issued the refund).
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

const ACTIVE = new Set(["pending", "sam2_processing", "cpu_processing"]);

export function useAsyncGenerate(opts: {
  tenantId: number | null;
  jobId: number | null;
  enabled: boolean;
  onDone: (resultUrl: string) => void;
  onFailed: (message?: string) => void;
}) {
  const { tenantId, jobId, enabled, onDone, onFailed } = opts;
  // Fire terminal callbacks at most once per job (guards a late extra poll).
  const firedFor = useRef<number | null>(null);

  // Reset the fire-once guard whenever polling is disabled, so a regenerate on the SAME jobId
  // fires its terminal callback again instead of being suppressed by the prior run.
  useEffect(() => {
    if (!enabled) firedFor.current = null;
  }, [enabled]);

  const query = trpc.studio.getJob.useQuery(
    { tenantId: tenantId ?? 0, jobId: jobId ?? 0 },
    {
      enabled: enabled && jobId != null && tenantId != null,
      // Poll while active; stop the moment a terminal state is reached (no infinite loop).
      refetchInterval: (q) => (q.state.data && !ACTIVE.has(q.state.data.status) ? false : 2000),
      refetchOnWindowFocus: false,
    }
  );

  const data = query.data;
  useEffect(() => {
    if (!enabled || jobId == null || !data) return;
    if (firedFor.current === jobId) return;
    if (data.status === "done") {
      firedFor.current = jobId;
      const variations = data.variations ?? [];
      onDone(variations.length ? variations[variations.length - 1].resultUrl : "");
    } else if (data.status === "failed") {
      firedFor.current = jobId;
      onFailed(data.errorMessage ?? undefined);
    }
  }, [data, enabled, jobId, onDone, onFailed]);

  return { status: data?.status ?? null };
}
