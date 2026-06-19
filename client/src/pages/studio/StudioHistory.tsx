/**
 * Studio History page — lists all past jobs for the tenant.
 */
import { trpc } from "@/lib/trpc";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { Link } from "wouter";

export default function StudioHistory() {
  const { tenant } = useTenant();
  const { data: jobs, isLoading } = trpc.studio.history.useQuery(
    { tenantId: tenant?.id ?? 0 },
    { enabled: !!tenant }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <h2 className="mt-4 text-lg font-semibold">No jobs yet</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Upload a garment image in the Editor to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Job History</h1>
        <p className="text-muted-foreground text-sm mt-1">
          All past editing jobs for {tenant?.name}.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <Card key={job.id} className="overflow-hidden hover:ring-2 hover:ring-primary/20 transition-all">
            <div className="aspect-[3/4] relative bg-muted">
              <img
                src={job.originalUrl}
                alt={job.title}
                className="w-full h-full object-cover"
              />
              <Badge
                className="absolute top-2 right-2"
                variant={
                  job.status === "done"
                    ? "default"
                    : job.status === "failed"
                    ? "destructive"
                    : "secondary"
                }
              >
                {job.status}
              </Badge>
            </div>
            <CardContent className="p-3">
              <p className="font-medium text-sm truncate">{job.title}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(job.createdAt).toLocaleDateString()} &middot;{" "}
                {job.creditsUsed ? `${job.creditsUsed} cr` : "—"}
              </p>
              {job.detectedElements.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {job.detectedElements.slice(0, 3).map((el: string) => (
                    <span
                      key={el}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                    >
                      {el}
                    </span>
                  ))}
                  {job.detectedElements.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{job.detectedElements.length - 3}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
