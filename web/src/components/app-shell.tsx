"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3Icon,
  Building2Icon,
  WalletIcon,
  CalendarCheckIcon,
  CalendarOffIcon,
  CameraIcon,
  Clock3Icon,
  LayoutDashboardIcon,
  MenuIcon,
  ScanFaceIcon,
  SettingsIcon,
  UserCircleIcon,
  UsersIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";

type NavItem = { href: string; label: string; icon: React.ElementType; soon?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/attendance", label: "Attendance", icon: CalendarCheckIcon, soon: true },
  { href: "/employees", label: "Employees", icon: UsersIcon, soon: true },
  { href: "/unknown", label: "Unknown faces", icon: ScanFaceIcon, soon: true },
  { href: "/shifts", label: "Schedules & roster", icon: Clock3Icon, soon: true },
  { href: "/cameras", label: "Cameras", icon: CameraIcon, soon: true },
  { href: "/reports", label: "Reports", icon: BarChart3Icon, soon: true },
  { href: "/leaves", label: "Leaves", icon: CalendarOffIcon, soon: true },
  { href: "/payroll", label: "Payroll", icon: WalletIcon, soon: true },
  { href: "/departments", label: "Departments", icon: Building2Icon, soon: true },
  { href: "/me", label: "My attendance", icon: UserCircleIcon, soon: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon, soon: true },
];

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <ScanFaceIcon className="size-4.5" />
      </span>
      <span className="font-heading text-lg font-semibold tracking-tight">Presence</span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        if (item.soon) {
          return (
            <span
              key={item.href}
              aria-disabled
              className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/70"
            >
              <Icon className="size-4" />
              {item.label}
              <Badge variant="outline" className="ml-auto h-4.5 px-1.5 text-[10px]">
                soon
              </Badge>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg bg-sidebar-accent"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <Icon className={cn("relative size-4", active && "text-primary")} />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children, demo }: { children: React.ReactNode; demo: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-backdrop flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r bg-sidebar/80 p-4 backdrop-blur lg:flex">
        <Logo />
        <NavList />
        <div className="mt-auto rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">No video is stored</p>
          <p className="mt-1">Only a face snapshot per check-in/out, kept 30 days.</p>
        </div>
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-6 p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Logo />
          <NavList onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/70 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <MenuIcon className="size-5" />
          </Button>
          <div className="lg:hidden">
            <Logo />
          </div>
          {demo && (
            <Badge variant="outline" className="ml-2 hidden border-warning/40 bg-warning-soft text-foreground sm:inline-flex">
              Demo data — connect Supabase to go live
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
