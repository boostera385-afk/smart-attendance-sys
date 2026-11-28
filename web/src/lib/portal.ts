/** Portal attendance: shared types + display maths. The database (self_check / recalc) is the source of truth. */

export type AttendanceMode = "portal" | "hybrid" | "camera";

export type AttendanceSettings = {
  mode: AttendanceMode;
  requireSelfie: boolean;
  requireLocation: boolean;
  maxAccuracyM: number;
};

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  mode: "portal",
  requireSelfie: true,
  requireLocation: true,
  maxAccuracyM: 100,
};

export type Office = { name: string; lat: number; lng: number; radius_m: number };

/** Shape returned by public.portal_today(). */
export type PortalToday = {
  now: string;
  work_date: string;
  mode: AttendanceMode;
  require_selfie: boolean;
  require_location: boolean;
  max_accuracy_m: number;
  employee_status: string;
  on_leave: boolean;
  holiday: boolean;
  overtime_paid: boolean;
  shift: {
    kind: "fixed" | "flexible";
    start_time: string;
    end_time: string;
    required_minutes: number | null;
    break_minutes: number;
    grace_in_minutes: number;
    grace_out_minutes: number;
    overtime_after_minutes: number;
    checkin_open_minutes: number;
    working_days: number[];
  } | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  day: {
    check_in_at: string | null;
    check_out_at: string | null;
    status: string;
    check_in_source: string | null;
    check_out_source: string | null;
    late_minutes: number;
    early_leave_minutes: number;
    overtime_minutes: number;
    extra_minutes: number;
    net_minutes: number | null;
    needs_review: boolean;
  } | null;
  offices: Office[];
};

const MIN = 60_000;
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

/** Great-circle distance in metres (same formula as public.distance_m). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function nearestOffice(offices: Office[], lat: number, lng: number) {
  let best: (Office & { distance: number }) | null = null;
  for (const o of offices) {
    const distance = distanceM(lat, lng, o.lat, o.lng);
    if (!best || distance < best.distance) best = { ...o, distance };
  }
  return best;
}

/** Same rule as self_check: radius + GPS error, but never more than 50 m of slack. */
export const insideOffice = (o: { distance: number; radius_m: number }, accuracy: number) =>
  o.distance <= o.radius_m + Math.min(accuracy, 50);

export type DayClock = {
  phase: "before" | "working" | "done";
  /** minutes the day is expected to last (fixed: start→end incl. paid break; flexible: required) */
  targetMin: number | null;
  workedMin: number;
  /** minutes left until the shift is done (0 once reached) */
  remainingMin: number | null;
  /** minutes past the shift end / required time */
  beyondMin: number;
  /** true when beyondMin counts as paid overtime (past threshold + overtime paid for this employee) */
  overtimeCounts: boolean;
  /** before check-in: how late a check-in right now would be (0 = on time) */
  lateIfNowMin: number;
  /** while working: how early a check-out right now would be (0 = not early) */
  earlyIfNowMin: number;
  /** before check-in, fixed shift: check-in opens at this time (ms) when it's still too early */
  opensAt: number | null;
  progress: number;
};

export function dayClock(t: PortalToday, now: number): DayClock {
  const inAt = ms(t.day?.check_in_at);
  const outAt = ms(t.day?.check_out_at);
  const start = ms(t.scheduled_start);
  const end = ms(t.scheduled_end);
  const s = t.shift;
  const phase = !inAt ? "before" : outAt ? "done" : "working";
  const until = outAt ?? now;
  const workedMin = inAt ? Math.max(0, Math.floor((until - inAt) / MIN)) : 0;

  let targetMin: number | null = null;
  let remainingMin: number | null = null;
  let beyondMin = 0;
  let lateIfNowMin = 0;
  let earlyIfNowMin = 0;
  let opensAt: number | null = null;

  if (s?.kind === "fixed" && start && end) {
    targetMin = Math.round((end - start) / MIN);
    remainingMin = Math.max(0, Math.ceil((end - until) / MIN));
    beyondMin = inAt ? Math.max(0, Math.floor((until - end) / MIN)) : 0;
    if (!inAt) {
      if (now > start + s.grace_in_minutes * MIN) lateIfNowMin = Math.floor((now - start) / MIN);
      const open = start - s.checkin_open_minutes * MIN;
      if (now < open) opensAt = open;
    } else if (!outAt && now < end - s.grace_out_minutes * MIN) {
      earlyIfNowMin = Math.ceil((end - now) / MIN);
    }
  } else if (s?.kind === "flexible" && s.required_minutes) {
    targetMin = s.required_minutes;
    remainingMin = Math.max(0, targetMin - workedMin);
    beyondMin = Math.max(0, workedMin - targetMin);
    if (inAt && !outAt && workedMin < targetMin) earlyIfNowMin = targetMin - workedMin;
  } else if (inAt) {
    beyondMin = workedMin; // day off: everything is extra time
  }

  const overtimeCounts = t.overtime_paid && !!s && beyondMin > s.overtime_after_minutes;
  const progress = targetMin ? Math.min(1, workedMin / targetMin) : inAt ? 1 : 0;
  return { phase, targetMin, workedMin, remainingMin, beyondMin, overtimeCounts, lateIfNowMin, earlyIfNowMin, opensAt, progress };
}
