/**
 * OrgAvatar — monogram tile for an organization. Firms read amber, individuals
 * read primary, so the two account types are visually distinct at a glance.
 */
import { cn } from "@/lib/utils";

export function OrgAvatar({
  name,
  type = "firm",
  className,
}: {
  name: string;
  type?: "firm" | "individual";
  className?: string;
}) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
        type === "individual" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-500",
        className
      )}
      aria-hidden
    >
      {initial}
    </div>
  );
}
