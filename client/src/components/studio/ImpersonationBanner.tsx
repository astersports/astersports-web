/**
 * ImpersonationBanner — persistent amber bar shown when a super_admin
 * is impersonating a firm. Displays the firm name and an Exit button
 * that clears the impersonation context and returns to /platform.
 */
import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImpersonateData {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  type: string;
  plan: string;
  creditBalance: number;
}

const STORAGE_KEY = "impersonate_tenant";

export function useImpersonation() {
  const [data, setData] = useState<ImpersonateData | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        setData(JSON.parse(raw));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  const exitImpersonation = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.href = "/platform";
  };

  return { impersonating: data, exitImpersonation };
}

export default function ImpersonationBanner() {
  const { impersonating, exitImpersonation } = useImpersonation();

  if (!impersonating) return null;

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
            ({impersonating.type} · {impersonating.plan || "No plan"} · {impersonating.creditBalance.toLocaleString()} credits)
          </span>
        </div>

        {/* Right: Exit button */}
        <Button
          variant="outline"
          size="sm"
          onClick={exitImpersonation}
          className="shrink-0 bg-black/10 border-black/20 text-black hover:bg-black/20 hover:text-black font-semibold text-xs gap-1.5 transition-transform duration-160 active:scale-[0.97]"
        >
          <X className="w-3.5 h-3.5" />
          Exit
        </Button>
      </div>
    </div>
  );
}
