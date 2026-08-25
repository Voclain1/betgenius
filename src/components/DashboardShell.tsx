"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Menu, X, Lock } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export type DashboardNavItem = {
  key: string;
  href: string;
  label: string;
  locked?: boolean;
};

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

// Sidebar collapse/expand is real state, not just a responsive breakpoint —
// desktop and mobile track it separately (`desktopCollapsed` / `mobileOpen`)
// so each can have its own sensible default (expanded on desktop, closed
// overlay on mobile) behind a single toggle button, mirroring the drawer
// pattern already used by the main site Nav.
export function DashboardShell({
  items,
  activeKey,
  title,
  userEmail,
  children,
}: {
  items: DashboardNavItem[];
  activeKey: string;
  title: string;
  userEmail: string;
  children: ReactNode;
}) {
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Same behavior as the main site Nav's mobile drawer: Escape closes it,
  // and background scroll is locked while it's open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  function toggleSidebar() {
    if (isMobileViewport()) setMobileOpen((v) => !v);
    else setDesktopCollapsed((v) => !v);
  }

  function handleNavigate() {
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 border-r border-brand-border bg-brand-card transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${desktopCollapsed ? "md:w-0 md:overflow-hidden md:border-r-0" : "md:w-64"}`}
      >
        <div className="flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto p-4 md:w-64">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold">
              <span className="text-brand">Bet</span>Genius
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="btn btn-ghost p-2 md:hidden"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const active = item.key === activeKey;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={handleNavigate}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                    active
                      ? "bg-brand/15 text-brand"
                      : item.locked
                        ? "text-gray-500 hover:bg-brand-bg"
                        : "text-gray-300 hover:bg-brand-bg"
                  }`}
                >
                  <span className="flex-1">{item.label}</span>
                  {item.locked && <Lock size={13} className="shrink-0 text-gray-500" />}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto pt-4 text-xs text-gray-500">
            Signed in as
            <br />
            <span className="text-gray-300">{userEmail}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-brand-border surface-blur px-4 py-3 backdrop-blur">
          <button
            type="button"
            aria-label="Toggle sidebar"
            aria-expanded={mobileOpen}
            onClick={toggleSidebar}
            className="btn btn-ghost p-2"
          >
            <Menu size={18} />
          </button>
          <span className="font-semibold">{title}</span>
          {/* Pushed right so the admin/dashboard shell carries the same control
              as the public nav — a theme chosen on one must be changeable on
              the other, since they are the same site to a signed-in admin. */}
          <ThemeToggle className="ml-auto" />
        </div>
        <main className="flex-1 space-y-6 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
