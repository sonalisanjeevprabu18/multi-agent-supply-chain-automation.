"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Leaf, X } from "lucide-react";
import { NAV_ITEMS } from "@/components/nav";

const SECTIONS = ["Operate", "Intelligence"] as const;

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();

  const body = (
    <div className="flex h-full flex-col bg-forest-900">
      <div
        className={`flex items-center gap-3 border-b border-white/10 px-4 py-5 ${
          collapsed ? "lg:justify-center lg:px-2" : ""
        }`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-forest-100 ring-1 ring-inset ring-white/15">
          <Leaf className="h-5 w-5" strokeWidth={1.6} />
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="font-display text-[15px] font-semibold tracking-[0.02em] text-white">
              SUPPLYFLOW AI
            </p>
            <p className="text-[11px] tracking-[0.02em] text-forest-100/60">
              Intelligent Supply Chain
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onCloseMobile}
          className="ml-auto rounded-lg p-1.5 text-forest-100/70 hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section} className="mb-5 last:mb-0">
            {!collapsed ? <p className="eyebrow mb-2 px-2 !text-forest-100/40">{section}</p> : null}
            <div className="space-y-1">
              {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onCloseMobile}
                    title={collapsed ? item.title : undefined}
                    className={`nav-link ${active ? "nav-link-active" : ""} ${
                      collapsed ? "lg:justify-center lg:px-0" : ""
                    }`}
                  >
                    {active ? (
                      <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-forest-300" />
                    ) : null}
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        active ? "text-forest-300" : "text-forest-100/55"
                      }`}
                      strokeWidth={1.7}
                    />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed ? (
        <div className="mx-3 mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <p className="text-[11px] font-semibold text-forest-100">7 agents · 1 workflow</p>
          <p className="mt-1 text-[11px] leading-relaxed text-forest-100/50">
            Forecast → monitor → optimise → procure → disruption → logistics → verify.
          </p>
        </div>
      ) : null}

      <div className="border-t border-white/10 px-3 py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`hidden w-full items-center gap-2 rounded-lg px-2 py-2 text-[12px] text-forest-100/55 transition hover:bg-white/[0.06] hover:text-white lg:flex ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" /> Collapse
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 transition-[width] duration-300 lg:block ${
          collapsed ? "w-[76px]" : "w-[248px]"
        }`}
      >
        {body}
      </aside>

      <div
        className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!mobileOpen}
      >
        <div
          className={`absolute inset-0 bg-forest-900/40 backdrop-blur-[2px] transition-opacity ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={onCloseMobile}
        />
        <div
          className={`absolute inset-y-0 left-0 w-[268px] shadow-lift transition-transform duration-300 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {body}
        </div>
      </div>
    </>
  );
}
