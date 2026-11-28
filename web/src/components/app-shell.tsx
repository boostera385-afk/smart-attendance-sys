"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  BarChart3Icon,
  Building2Icon,
  WalletIcon,
  CalendarCheckIcon,
  CalendarOffIcon,
  CameraIcon,
  Clock3Icon,
  LayoutDashboardIcon,
  LogOutIcon,
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
import { InstallButton } from "@/components/pwa";
import { BrandLockup, PropertyLine } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { signOut } from "@/app/login/actions";

type Role = "super_admin" | "admin" | "manager" | "employee";
type NavItem = { href: string; label: string; icon: React.ElementType; roles: Role[]; soon?: boolean };

const ALL: Role[] = ["super_admin", "admin", "manager", "employee"];
const ADMINS: Role[] = ["super_admin", "admin"];
const LEADS: Role[] = ["super_admin", "admin", "manager"];

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon, roles: LEADS },
  { href: "/me", label: "My attendance", icon: UserCircleIcon, roles: ALL },
  { href: "/attendance", label: "Attendance", icon: CalendarCheckIcon, roles: LEADS },
  { href: "/employees", label: "Employees", icon: UsersIcon, roles: ADMINS },
  { href: "/unknown", label: "Unknown faces", icon: ScanFaceIcon, roles: ADMINS },
  { href: "/shifts", label: "Schedules & roster", icon: Clock3Icon, roles: LEADS },
  { href: "/cameras", label: "Cameras", icon: CameraIcon, roles: ADMINS },
  { href: "/reports", label: "Reports", icon: BarChart3Icon, roles: LEADS },
  { href: "/leaves", label: "Leaves", icon: CalendarOffIcon, roles: ALL },
  { href: "/payroll", label: "Payroll", icon: WalletIcon, roles: ADMINS },
  { href: "/departments", label: "Departments", icon: Building2Icon, roles: ADMINS },
  { href: "/settings", label: "Settings", icon: SettingsIcon, roles: ADMINS },
];

type Me = { role: Role; email: string } | null;

/** Role decides which menu items show. Pages and data are still protected on the server (RLS + checks). */
function useMe(): Me {
  const [me, setMe] = useState<Me>(isSupabaseConfigured ? null : { role: "super_admin", email: "demo" });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    let alive = true;
    (async () => {
      const [{ data: u }, { data: role }] = await Promise.all([supabase.auth.getUser(), supabase.rpc("current_app_role")]);
      if (alive && role) setMe({ role: role as Role, email: u.user?.email ?? "" });
    })();
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

function Logo() {
  return <BrandLockup className="px-2" />;
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="my-1 h-7 animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
  );
}

function NavList({ onNavigate, me }: { onNavigate?: () => void; me: Me }) {
  const pathname = usePathname();
  const items = me ? NAV.filter((i) => i.roles.includes(me.role)) : [];
  return (
    <nav className="flex flex-col gap-0.5" aria-busy={!me}>
      {!me && <NavSkeleton />}
      {items.map((item) => {
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

function UserBox({ me }: { me: Me }) {
  if (!me || !isSupabaseConfigured) return null;
  return (
    <form action={signOut} className="flex items-center gap-2 rounded-xl border bg-card/60 p-2 pl-3 text-xs">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{me.email}</span>
        <span className="text-muted-foreground">{me.role.replace("_", " ")}</span>
      </span>
      <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out">
        <LogOutIcon />
      </Button>
    </form>
  );
}

export function AppShell({ children, notice }: { children: React.ReactNode; notice?: string }) {
  const [open, setOpen] = useState(false);
  const me = useMe();
  return (
    <div className="app-backdrop flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar/90 backdrop-blur lg:flex">
        <div className="slice-stripe" />
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <Logo />
          <Suspense fallback={<NavSkeleton />}>
            <NavList me={me} />
          </Suspense>
          <div className="mt-auto flex flex-col gap-3">
            <UserBox me={me} />
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
          <Suspense fallback={<NavSkeleton />}>
            <NavList me={me} onNavigate={() => setOpen(false)} />
          </Suspense>
          <UserBox me={me} />
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
            <InstallButton />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
