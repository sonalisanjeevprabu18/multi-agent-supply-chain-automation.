"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  LineChart,
  Radio,
  ShoppingCart,
  Truck,
  BoxesIcon,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Executive", icon: LayoutDashboard },
  { href: "/forecasting", label: "Demand Forecasting", icon: LineChart },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/procurement", label: "Procurement", icon: ShoppingCart },
  { href: "/disruptions", label: "Disruptions", icon: Truck },
  { href: "/agents", label: "Agent Monitoring", icon: Radio },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-[rgb(var(--panel))] lg:flex">
      <div className="flex items-center gap-3 border-b px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
          <BoxesIcon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">Supply Chain AI</p>
          <p className="text-xs muted">Control tower</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                  : "muted hover:bg-slate-100/70 hover:text-slate-900 dark:hover:bg-slate-800/70 dark:hover:text-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t px-4 py-4 text-xs muted">
        <p className="font-semibold text-[rgb(var(--text))]">7 specialized agents</p>
        <p className="mt-1 leading-relaxed">
          LangGraph orchestrates forecasting → inventory → procurement → disruption →
          logistics → verification.
        </p>
      </div>
    </aside>
  );
}
