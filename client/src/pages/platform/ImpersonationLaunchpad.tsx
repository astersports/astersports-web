/**
 * GlobalImpersonationLaunchpad — ⌘K command palette to jump straight into any
 * account by impersonating it. (Spec §16.2)
 *
 * Port note: the org `platform.listAccounts` returns `{ accounts, total }`, so we read
 * the page array off `.accounts`.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Eye } from "lucide-react";

export default function ImpersonationLaunchpad() {
  const [open, setOpen] = useState(false);
  const { data } = trpc.platform.listAccounts.useQuery({ type: "all", limit: 200 }, { enabled: open });
  const accounts = data?.accounts;

  const impersonate = trpc.platform.impersonate.useMutation({
    onSuccess: (d) => {
      toast.success(`Viewing as ${d.tenantName}`, { description: "Redirecting…" });
      window.location.href = "/studio";
    },
    onError: (err) => toast.error(err.message),
  });

  // ⌘K / Ctrl+K opens the launchpad.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5"
        onClick={() => setOpen(true)}
      >
        <Eye className="w-4 h-4 mr-1.5" />
        <span className="hidden sm:inline">Jump to account</span>
        <kbd className="ml-2 hidden sm:inline rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">⌘K</kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search accounts to impersonate…" />
        <CommandList>
          <CommandEmpty>No accounts found.</CommandEmpty>
          <CommandGroup heading="Accounts">
            {(accounts ?? []).map((a: any) => (
              <CommandItem
                key={a.id}
                value={`${a.name} ${a.ownerEmail ?? ""}`}
                onSelect={() => impersonate.mutate({ tenantId: a.id })}
                className="flex items-center justify-between"
              >
                <span className="truncate">
                  {a.name}
                  <span className="ml-2 text-xs text-muted-foreground capitalize">{a.type}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{a.creditBalance.toLocaleString()} cr</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
