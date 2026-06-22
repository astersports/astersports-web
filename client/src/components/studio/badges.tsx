/**
 * Shared admin badges — used by BOTH the tenant-facing admin and the super-admin
 * Platform Console so the two surfaces read as one system (spec §14).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Building2, User, Crown, Shield } from "lucide-react";

export function TypeBadge({ type, className }: { type: "firm" | "individual"; className?: string }) {
  const isFirm = type === "firm";
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", className)}>
      {isFirm ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
      {isFirm ? "Firm" : "Individual"}
    </Badge>
  );
}

const ROLE_STYLE: Record<string, { label: string; icon: typeof Crown; cls: string }> = {
  owner: { label: "Owner", icon: Crown, cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  admin: { label: "Admin", icon: Shield, cls: "bg-primary/10 text-primary border-primary/20" },
  member: { label: "Member", icon: User, cls: "bg-muted text-muted-foreground border-border" },
};

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const c = ROLE_STYLE[role] ?? ROLE_STYLE.member;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", c.cls, className)}>
      <Icon className="h-3 w-3" />
      {c.label}
    </Badge>
  );
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  trial: { label: "Trial", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  disabled: { label: "Disabled", cls: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const c = STATUS_STYLE[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", c.cls, className)}>
      {c.label}
    </Badge>
  );
}
