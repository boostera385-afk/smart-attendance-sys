import Link from "next/link";
import { cn } from "@/lib/utils";
import { PastryLogo } from "@/components/pastry-logo";

/** Company that owns Presence; shown in the copyright notice. */
export const COMPANY = "Pastry Marketing";
export const PRODUCT = "Presence";
/** Static so pages can be prerendered; update yearly or when re-publishing. */
const COPYRIGHT_YEAR = 2026;

/** App lockup: official Pastry wordmark + "Presence · Attendance". */
export function BrandLockup({ href = "/dashboard", className }: { href?: string | null; className?: string }) {
  const inner = (
    <span className="flex flex-col items-start gap-1 leading-none">
      <PastryLogo title="" className="h-7 w-auto" />
      <span className="pl-0.5 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
        {PRODUCT} · Attendance
      </span>
    </span>
  );
  const cls = cn("flex items-center", className);
  return href ? (
    <Link href={href} className={cls} aria-label={`${PRODUCT} by ${COMPANY} — home`}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

/**
 * Copyright notice (same as the Pastry CRM sign-in): Pastry logo +
 * "© <year> Pastry Marketing. All rights reserved." Muted and small so it never competes.
 */
export function PropertyLine({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "flex flex-col items-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground/70",
        className,
      )}
    >
      {/* The text below names the company, so the logo is decorative for screen readers. */}
      <PastryLogo title="" className="h-5 w-auto opacity-90" />
      <p>
        © {COPYRIGHT_YEAR} <span className="font-semibold text-muted-foreground">{COMPANY}</span>. All rights reserved.
      </p>
    </footer>
  );
}
