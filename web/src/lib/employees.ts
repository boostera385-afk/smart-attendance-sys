import type { AppRole } from "@/lib/auth";

/** Everything the add/edit employee form sends. Shared by the client form and server actions. */
export type EmployeeInput = {
  fullName: string;
  employeeCode: string;
  email: string;
  phone: string;
  designation: string;
  joinedOn: string;
  departmentId: string; // "" when newDepartment is used
  newDepartment: string;
  branchId: string;
  role: AppRole;
  managesDepartment: boolean;

  scheduleChanged: boolean; // always true on create
  scheduleFrom: string;
  kind: "fixed" | "flexible";
  start: string;
  end: string;
  requiredHours: number;
  workingDays: number[];
  breakMinutes: number;
  breakMode: "deduct" | "paid";
  graceIn: number;
  graceOut: number;
  overtimeAfter: number;

  salaryChanged: boolean;
  salaryFrom: string;
  basicSalary: number | null;
  allowances: { name: string; amount: number }[];
  lateDeduction: boolean;
  overtimeEnabled: boolean;
};

export type Option = { id: string; name: string };

export type EmployeeFormData = {
  departments: Option[];
  branches: Option[];
  canAssignAdmin: boolean;
  initial?: Partial<EmployeeInput> & { id: string; hasAccount: boolean; status: string };
};

export const ROLE_LABEL: Record<AppRole, string> = {
  employee: "Employee",
  manager: "Manager (team lead)",
  admin: "Admin (HR)",
  super_admin: "Super admin",
};

export function validateEmployee(i: EmployeeInput, creating: boolean): string | null {
  if (i.fullName.trim().length < 2) return "Enter the employee's full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())) return "Enter a valid email address.";
  if (i.phone.trim() && !/^\+[1-9]\d{7,14}$/.test(i.phone.replace(/[\s-]/g, ""))) {
    return "Enter the WhatsApp number in international format, e.g. +923001234567.";
  }
  if (!i.departmentId && !i.newDepartment.trim()) return "Choose a department (or add a new one).";
  if (!i.joinedOn) return "Enter the joining date.";
  if (creating || i.scheduleChanged) {
    if (!i.scheduleFrom) return "Enter the date the working hours start from.";
    if (!i.workingDays.length) return "Select at least one working day.";
    if (i.kind === "fixed" && (!i.start || !i.end || i.start === i.end)) return "Start and end time must be different.";
    if (i.kind === "flexible" && !(i.requiredHours > 0 && i.requiredHours <= 16)) return "Required hours must be 1–16.";
    if (i.breakMinutes < 0 || i.breakMinutes > 240) return "Break must be 0–240 minutes.";
  }
  if (i.salaryChanged) {
    if (i.basicSalary == null || !(i.basicSalary >= 0)) return "Enter the basic salary.";
    if (!i.salaryFrom) return "Enter the date the salary applies from.";
    if (i.allowances.some((a) => !a.name.trim() || !(a.amount > 0))) return "Each allowance needs a name and an amount.";
  }
  return null;
}
