/**
 * Firm member management — role control, status, suspend/reactivate, remove,
 * and an expandable per-member detail (joined, last in-studio activity, spend,
 * jobs). Reads the enriched tenants.members query.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Users, Crown, Loader2, MoreVertical, ChevronDown, Ban, RotateCcw, Trash2 } from "lucide-react";

const MEMBERS_PAGE = 20;

function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "Never";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function MembersList({ tenantId, isOwner }: { tenantId: number; isOwner: boolean }) {
  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.tenants.members.useQuery(
    { tenantId },
    { enabled: !!tenantId }
  );
  const [visibleCount, setVisibleCount] = useState(MEMBERS_PAGE);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Reset the reveal window when switching firms.
  useEffect(() => setVisibleCount(MEMBERS_PAGE), [tenantId]);

  const invalidate = () => utils.tenants.members.invalidate({ tenantId });
  const roleMut = trpc.firmAdmin.toggleRole.useMutation({
    onSuccess: () => { invalidate(); toast.success("Role updated"); },
    onError: (e) => toast.error(e.message),
  });
  const statusMut = trpc.firmAdmin.setMemberStatus.useMutation({
    onSuccess: (d) => {
      invalidate();
      toast.success(d.status === "disabled" ? "Member suspended" : "Member reactivated");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeMut = trpc.firmAdmin.removeMember.useMutation({
    onSuccess: () => { invalidate(); toast.success("Member removed"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Members
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !members || members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <div className="space-y-1">
            {members.slice(0, visibleCount).map((m) => {
              const isOwnerRow = m.role === "owner";
              const isSuspended = m.status === "disabled";
              const isInvited = m.status === "invited";
              const displayName = m.user?.name || m.invitedEmail || "Unknown";
              const displayEmail = m.user?.email || m.invitedEmail || "";
              const expanded = expandedId === m.id;

              return (
                <div key={m.id} className="border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2 px-2 py-2.5">
                    <button
                      onClick={() => setExpandedId(expanded ? null : m.id)}
                      className="flex flex-1 items-center gap-2 min-w-0 text-left"
                      aria-label={expanded ? "Collapse member detail" : "Expand member detail"}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-sm font-medium truncate ${isSuspended ? "text-muted-foreground line-through" : ""}`}>
                            {displayName}
                          </span>
                          <RoleChip role={m.role} />
                          {isInvited && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Invited</Badge>
                          )}
                          {isSuspended && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive/50 text-destructive">
                              Suspended
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {displayEmail}
                          {m.status === "active" ? ` · active ${timeAgo(m.lastActiveAt)}` : ""}
                        </p>
                      </div>
                    </button>

                    {!isOwnerRow && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label="Member actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isSuspended ? (
                            <DropdownMenuItem onClick={() => statusMut.mutate({ tenantId, membershipId: m.id, status: "active" })}>
                              <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => statusMut.mutate({ tenantId, membershipId: m.id, status: "disabled" })}>
                              <Ban className="h-3.5 w-3.5 mr-2" /> Suspend
                            </DropdownMenuItem>
                          )}
                          {isOwner && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  if (confirm(`Remove ${displayName} from this firm? This can't be undone.`)) {
                                    removeMut.mutate({ tenantId, membershipId: m.id });
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {expanded && (
                    <div className="px-3 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2.5 text-xs">
                      {!isOwnerRow && (
                        <div className="col-span-2 sm:col-span-1">
                          <p className="text-muted-foreground mb-1">Role</p>
                          <select
                            value={m.role}
                            disabled={roleMut.isPending}
                            onChange={(e) =>
                              roleMut.mutate({
                                tenantId,
                                membershipId: m.id,
                                field: "role",
                                value: e.target.value as "admin" | "member",
                              })
                            }
                            className="h-8 w-full rounded-md bg-muted/50 border border-border text-xs px-2"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      )}
                      <Detail label="Joined" value={formatDate(m.joinedAt)} />
                      <Detail label="Last active" value={timeAgo(m.lastActiveAt)} />
                      <Detail label="Jobs" value={String(m.jobsCount)} />
                      <Detail label="Spent · 7d" value={m.spent7d.toLocaleString()} />
                      <Detail label="Spent · all" value={m.spentAll.toLocaleString()} />
                    </div>
                  )}
                </div>
              );
            })}

            {members.length > visibleCount && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setVisibleCount((c) => c + MEMBERS_PAGE)}
                  className="px-4 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  Load more ({visibleCount} of {members.length})
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoleChip({ role }: { role: string }) {
  if (role === "owner") {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-500">
        <Crown className="h-2.5 w-2.5 mr-0.5" /> Owner
      </Badge>
    );
  }
  if (role === "admin") {
    return <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-400">Admin</Badge>;
  }
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Member</Badge>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}
