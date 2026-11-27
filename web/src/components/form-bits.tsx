import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(selectClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title text-4xl md:text-5xl">{title}</h1>
        {description && <p className="mt-3 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warning", children }: { tone?: "warning" | "info" | "danger"; children: React.ReactNode }) {
  const cls = {
    warning: "border-warning/40 bg-warning-soft",
    info: "border-info/30 bg-info-soft",
    danger: "border-danger/30 bg-danger-soft",
  }[tone];
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", cls)}>{children}</div>;
}

const STATUS_TONE: Record<string, string> = {
  present: "border-success/30 bg-success-soft text-success",
  active: "border-success/30 bg-success-soft text-success",
  approved: "border-success/30 bg-success-soft text-success",
  paid: "border-success/30 bg-success-soft text-success",
  online: "border-success/30 bg-success-soft text-success",
  processed: "border-success/30 bg-success-soft text-success",
  late: "border-warning/40 bg-warning-soft text-warning",
  half_day: "border-warning/40 bg-warning-soft text-warning",
  pending: "border-warning/40 bg-warning-soft text-warning",
  pending_enrollment: "border-warning/40 bg-warning-soft text-warning",
  invited: "border-info/30 bg-info-soft text-info",
  draft: "border-info/30 bg-info-soft text-info",
  leave: "border-info/30 bg-info-soft text-info",
  holiday: "border-info/30 bg-info-soft text-info",
  absent: "border-danger/30 bg-danger-soft text-danger",
  rejected: "border-danger/30 bg-danger-soft text-danger",
  offline: "border-danger/30 bg-danger-soft text-danger",
  error: "border-danger/30 bg-danger-soft text-danger",
  failed: "border-danger/30 bg-danger-soft text-danger",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONE[status] ?? "text-muted-foreground",
      )}
    >
      {label ?? status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}
