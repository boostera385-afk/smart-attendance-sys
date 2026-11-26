// Demo data shown until Supabase is connected. Deterministic (no Math.random) to avoid hydration mismatch.

export type CheckEvent = {
  id: string;
  name: string;
  department: string;
  camera: string;
  type: "check_in" | "check_out";
  time: string; // HH:mm
  status: "on_time" | "late";
  confidence: number;
};

export type CameraHealth = {
  name: string;
  group: string;
  role: "Entry" | "Exit" | "Both" | "Presence" | "Disabled";
  status: "online" | "offline";
  fps: number;
};

export const todayStats = {
  totalEmployees: 48,
  present: 39,
  late: 6,
  absent: 5,
  onLeave: 4,
  avgArrival: "09:07",
};

export const recentEvents: CheckEvent[] = [
  { id: "1", name: "Ayesha Khan", department: "SEO", camera: "OFFICE", type: "check_in", time: "09:14", status: "late", confidence: 0.94 },
  { id: "2", name: "Bilal Ahmed", department: "ND TEAM", camera: "OFFICE", type: "check_in", time: "09:09", status: "on_time", confidence: 0.97 },
  { id: "3", name: "Sara Malik", department: "Facebook team", camera: "OFFICE", type: "check_in", time: "09:03", status: "on_time", confidence: 0.96 },
  { id: "4", name: "Usman Tariq", department: "Delivery", camera: "OFFICE", type: "check_in", time: "08:58", status: "on_time", confidence: 0.92 },
  { id: "5", name: "Hina Raza", department: "ND TEAM", camera: "OFFICE", type: "check_in", time: "08:55", status: "on_time", confidence: 0.98 },
  { id: "6", name: "Omar Farooq", department: "SEO", camera: "OFFICE", type: "check_in", time: "08:51", status: "on_time", confidence: 0.95 },
];

/** Feed of arrivals the demo "live" stream cycles through. */
export const demoArrivals: Omit<CheckEvent, "id" | "time">[] = [
  { name: "Zain Ali", department: "Facebook team", camera: "OFFICE", type: "check_in", status: "late", confidence: 0.93 },
  { name: "Maryam Iqbal", department: "SEO", camera: "OFFICE", type: "check_in", status: "late", confidence: 0.96 },
  { name: "Hamza Sheikh", department: "ND TEAM", camera: "H6C (B…)", type: "check_out", status: "on_time", confidence: 0.91 },
  { name: "Fatima Noor", department: "Delivery", camera: "OFFICE", type: "check_in", status: "late", confidence: 0.95 },
];

export const weeklyTrend = [
  { day: "Thu", present: 41, late: 4, absent: 3 },
  { day: "Fri", present: 38, late: 7, absent: 3 },
  { day: "Mon", present: 43, late: 3, absent: 2 },
  { day: "Tue", present: 40, late: 5, absent: 3 },
  { day: "Wed", present: 42, late: 4, absent: 2 },
  { day: "Thu", present: 39, late: 6, absent: 3 },
  { day: "Today", present: 39, late: 6, absent: 5 },
];

export const arrivalsByHour = [
  { slot: "08:00", count: 3 },
  { slot: "08:15", count: 6 },
  { slot: "08:30", count: 9 },
  { slot: "08:45", count: 11 },
  { slot: "09:00", count: 8 },
  { slot: "09:15", count: 4 },
  { slot: "09:30", count: 2 },
  { slot: "09:45+", count: 2 },
];

export const departmentRates = [
  { department: "ND TEAM", rate: 96 },
  { department: "Facebook team", rate: 91 },
  { department: "SEO", rate: 88 },
  { department: "Delivery", rate: 84 },
];

export const cameras: CameraHealth[] = [
  { name: "OFFICE", group: "—", role: "Entry", status: "online", fps: 2.0 },
  { name: "H6C (B…) 1", group: "ND TEAM", role: "Presence", status: "online", fps: 1.0 },
  { name: "H6C (B…) 2", group: "Facebook team", role: "Presence", status: "online", fps: 1.0 },
  { name: "SEO", group: "—", role: "Presence", status: "online", fps: 1.0 },
  { name: "DELIV…", group: "—", role: "Exit", status: "offline", fps: 0 },
  { name: "Outdoor", group: "—", role: "Disabled", status: "online", fps: 0 },
];
