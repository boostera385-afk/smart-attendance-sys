export const TZ = "Asia/Karachi";

/** Today's date (YYYY-MM-DD) in the office timezone. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(d.length === 10 ? `${d}T00:00:00Z` : d),
  );
}

export function fmtMonth(d: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${d.slice(0, 7)}-01T00:00:00Z`),
  );
}

export function fmtMinutes(m: number | null | undefined): string {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const mm = Math.abs(m % 60);
  return h ? `${h}h ${String(mm).padStart(2, "0")}m` : `${mm}m`;
}

export function fmtMoney(n: number | string | null | undefined, currency = "PKR"): string {
  const v = Number(n ?? 0);
  return `${currency} ${v.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function fmtDays(days: number[] | null | undefined): string {
  if (!days?.length) return "—";
  const s = [...days].sort((a, b) => a - b);
  const contiguous = s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  if (contiguous && s.length > 2) return `${WEEKDAYS[s[0] - 1]}–${WEEKDAYS[s[s.length - 1] - 1]}`;
  return s.map((d) => WEEKDAYS[d - 1]).join(", ");
}

/** "Mon 09:00" → combine a local date + HH:MM into an ISO timestamp in the office timezone (+05:00, no DST). */
export function localToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:00`).toISOString();
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
