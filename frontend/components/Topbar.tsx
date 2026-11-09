"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Boxes,
  ChevronRight,
  Menu,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { navItemFor } from "@/components/nav";
import { API_BASE } from "@/lib/api";
import { todayLabel } from "@/lib/format";
import type { Disruption, Product } from "@/types";

type AlertGroup = Record<string, Array<{ sku: string; product_name: string; warehouse_code: string }>>;

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const item = navItemFor(pathname);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  const [alerts, setAlerts] = useState<AlertGroup>({});
  const [disruptions, setDisruptions] = useState<Disruption[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (bellRef.current && !bellRef.current.contains(target)) setNotificationsOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/products?search=${encodeURIComponent(term)}&limit=6`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("search failed");
        setResults((await response.json()) as Product[]);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [alertResponse, disruptionResponse] = await Promise.all([
          fetch(`${API_BASE}/api/inventory/alerts`, { cache: "no-store" }),
          fetch(`${API_BASE}/api/disruptions/active`, { cache: "no-store" }),
        ]);
        if (!cancelled) {
          setAlerts(alertResponse.ok ? ((await alertResponse.json()) as AlertGroup) : {});
          setDisruptions(
            disruptionResponse.ok ? ((await disruptionResponse.json()) as Disruption[]) : [],
          );
        }
      } catch {
        if (!cancelled) {
          setAlerts({});
          setDisruptions([]);
        }
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const notifications = useMemo(() => {
    const critical = (alerts.critical ?? []).slice(0, 3).map((row) => ({
      key: `c-${row.sku}-${row.warehouse_code}`,
      title: `${row.sku} at critical stock`,
      detail: `${row.warehouse_code} · ${row.product_name}`,
      href: "/inventory?alert=critical",
      tone: "danger" as const,
    }));
    const low = (alerts.low ?? []).slice(0, 2).map((row) => ({
      key: `l-${row.sku}-${row.warehouse_code}`,
      title: `${row.sku} below reorder point`,
      detail: `${row.warehouse_code} · reorder recommended`,
      href: "/inventory?alert=low",
      tone: "warn" as const,
    }));
    const blocked = disruptions.slice(0, 2).map((row) => ({
      key: `d-${row.id}`,
      title: `${row.supplier_name} disruption`,
      detail: `${row.disruption_type.replace(/_/g, " ")} · ${row.delay_days} day delay`,
      href: "/disruptions",
      tone: "danger" as const,
    }));
    return [...blocked, ...critical, ...low];
  }, [alerts, disruptions]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setSearchOpen(false);
    router.push(`/inventory?search=${encodeURIComponent(term)}`);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ivory/85 backdrop-blur-md">
      <div className="flex h-[68px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMobile}
          className="rounded-lg p-2 text-forest-700 hover:bg-forest-50 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <nav className="flex items-center gap-1.5 text-[11px] text-stone" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-forest-700">
              SupplyFlow AI
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>{item.section}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-forest-800">{item.title}</span>
          </nav>
          <h1 className="truncate font-display text-[17px] font-semibold text-forest-900">
            {item.title}
          </h1>
        </div>

        <div className="relative hidden md:block" ref={searchRef}>
          <form onSubmit={submitSearch}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search products or SKUs…"
              className="h-10 w-[248px] rounded-xl border border-line bg-white pl-9 pr-9 text-sm outline-none transition placeholder:text-stone/70 focus:border-forest-300 focus:ring-2 focus:ring-forest-200/60 xl:w-[300px]"
              aria-label="Search products"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone hover:text-forest-800"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </form>

          {searchOpen && query.trim().length >= 2 ? (
            <div className="absolute right-0 top-12 z-40 w-[340px] animate-fade-in overflow-hidden rounded-xl border border-line bg-white shadow-lift">
              <p className="border-b border-line px-4 py-2 text-[11px] uppercase tracking-[0.1em] text-stone">
                {searching ? "Searching…" : `${results.length} product match(es)`}
              </p>
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    router.push(`/inventory?search=${encodeURIComponent(product.sku)}`);
                  }}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-forest-50"
                >
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-forest-500" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {product.name}
                    </span>
                    <span className="block text-xs text-stone">
                      {product.sku} · {product.category}
                    </span>
                  </span>
                </button>
              ))}
              {!searching && results.length === 0 ? (
                <p className="px-4 py-4 text-xs text-stone">No product matches that term.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-forest-700 transition hover:border-forest-300"
            aria-label="Notifications"
          >
            <Bell className="h-[18px] w-[18px]" />
            {notifications.length ? (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-white" />
            ) : null}
          </button>

          {notificationsOpen ? (
            <div className="absolute right-0 top-12 z-40 w-[330px] animate-fade-in overflow-hidden rounded-xl border border-line bg-white shadow-lift">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-forest-900">Operational alerts</p>
                <span className="text-[11px] text-stone">{notifications.length} open</span>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-5 text-xs text-stone">
                    No inventory or supplier alerts are active.
                  </p>
                ) : (
                  notifications.map((entry) => (
                    <Link
                      key={entry.key}
                      href={entry.href}
                      onClick={() => setNotificationsOpen(false)}
                      className="flex gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-forest-50"
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                          entry.tone === "danger"
                            ? "bg-[#FBEDEC] text-[#A9443E]"
                            : "bg-[#FBF3E4] text-[#94651F]"
                        }`}
                      >
                        {entry.tone === "danger" ? (
                          <TriangleAlert className="h-3.5 w-3.5" />
                        ) : (
                          <Boxes className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink">{entry.title}</span>
                        <span className="block truncate text-[11px] text-stone">{entry.detail}</span>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="hidden items-center gap-3 border-l border-line pl-4 xl:flex">
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.08em] text-stone">Today</p>
            <p className="text-[13px] font-medium text-forest-900">{todayLabel()}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-l border-line pl-3 sm:pl-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-900 text-[12px] font-semibold text-white">
            SO
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-[13px] font-medium text-ink">Supply Chain Ops</p>
            <p className="text-[11px] text-stone">Operations lead</p>
          </div>
        </div>
      </div>
    </header>
  );
}
