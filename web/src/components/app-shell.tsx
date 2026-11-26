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
import { BrandLockup, PropertyLine } from "@/components/brand";

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
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function Logo() {
  return <BrandLockup className="px-2" />;
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
                className="absolute inset-0 rounded-lg bg-sidebar-accent shadow-[inset_3px_0_0_var(--brand)]"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <Icon className={cn("relative size-4", active && "text-foreground dark:text-brand")} />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children, notice }: { children: React.ReactNode; notice?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-backdrop flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar/90 backdrop-blur lg:flex">
        <div className="slice-stripe" />
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <Logo />
          <NavList />
          <div className="mt-auto flex flex-col gap-3">
            <div className="rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">No video is stored</p>
              <p className="mt-1">Only a face snapshot per check-in/out, kept 30 days.</p>
            </div>
            <PropertyLine className="border-t pt-4" />
          </div>
        </div>
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-6 p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Logo />
          <NavList onNavigate={() => setOpen(false)} />
          <PropertyLine className="mt-auto border-t pt-4" />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/70 px-4 backdrop-blur md:px-6">
          <div className="slice-stripe absolute inset-x-0 top-0 lg:hidden" />          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <MenuIcon className="size-5" />
          </Button>
          <div className="lg:hidden">
            <Logo />
          </div>
          {notice && (
            <Badge variant="outline" className="ml-2 hidden border-warning/40 bg-warning-soft text-foreground sm:inline-flex">
              {notice}
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
