"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("supplyflow.sidebar") === "collapsed");
    const density = window.localStorage.getItem("supplyflow.density");
    if (density) document.documentElement.dataset.density = density;
  }, []);

  function toggleCollapse() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("supplyflow.sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <footer className="border-t border-line px-4 py-4 text-[11px] leading-relaxed text-stone sm:px-6 lg:px-8">
          SUPPLYFLOW AI · Synthetic demonstration data for an Indian SME distributor. Purchase
          orders, transfers and disruptions are simulated planning records; no message is sent to a
          supplier and no LLM is required for core decisions.
        </footer>
      </div>
    </div>
  );
}
