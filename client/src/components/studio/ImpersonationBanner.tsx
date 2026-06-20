/**
 * ImpersonationBanner — persistent amber bar shown when a super_admin
 * is impersonating a firm via server-side JWT cookie.
 * Reads state from `platform.impersonationStatus` and clears via
 * `platform.exitImpersonation` mutation.
 */
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function useImpersonation() {
  const { data, isLoading } = trpc.platform.impersonationStatus.useQuery(
    undefined,
    { refetchOnWindowFocus: false, retry: false }
  );

  const utils = trpc.useUtils();
  const exitMutation = trpc.platform.exitImpersonation.useMutation({
    onSuccess: () => {
      // Clear cached state and redirect
      utils.platform.impersonationStatus.invalidate();
      window.location.href = "/platform";
    },
  });

  return {
    impersonating: data?.active ? data : null,
    isLoading,
    exitImpersonation: () => exitMutation.mutate(),
    isExiting: exitMutation.isPending,
  };
}

export default function ImpersonationBanner() {
  const { impersonating, isLoading, exitImpersonation, isExiting } = useImpersonation();

  // Don't render anything while loading or if not impersonating
  if (isLoading || !impersonating) return null;

  return (
    <div className="sticky top-0 z-[60] w-full bg-gradient-to-r from-amber-600 to-amber-500 text-black shadow-lg shadow-amber-500/20">
      <div className="container flex items-center justify-between gap-3 py-2 px-4">
        {/* Left: icon + message */}
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 shrink-0 opacity-80" />
          <span className="text-sm font-semibold truncate">
            Viewing as{" "}
            <span className="font-bold">{impersonating.tenantName}</span>
          </span>
          <span className="hidden sm:inline text-xs opacity-70 font-medium">
            (Impersonating · Tenant #{impersonating.tenantId})
          </span>
        </div>

        {/* Right: Exit button */}
        <Button
          variant="outline"
          size="sm"
          onClick={exitImpersonation}
          disabled={isExiting}
          className="shrink-0 bg-black/10 border-black/20 text-black hover:bg-black/20 hover:text-black font-semibold text-xs gap-1.5 transition-transform duration-160 active:scale-[0.97]"
        >
          <X className="w-3.5 h-3.5" />
          {isExiting ? "Exiting..." : "Exit"}
        </Button>
      </div>
    </div>
  );
}
