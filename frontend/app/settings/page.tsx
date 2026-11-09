"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  Globe2,
  Loader2,
  MonitorCog,
  RefreshCw,
  ServerCog,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Card,
  Field,
  PageHeader,
  Segmented,
  Skeleton,
  StatRow,
  Toast,
} from "@/components/ui";
import { API_BASE, WORKFLOW_SYNC, healthUrl } from "@/lib/api";
import { dateTime, money, num, percent, todayLabel } from "@/lib/format";

type Health = {
  status: string;
  app_env: string;
  database: { status: string; dialect: string };
  timestamp: string;
  agent_workflow: string;
  llm_required: boolean;
};

type Density = "comfortable" | "compact";

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [density, setDensity] = useState<Density>("comfortable");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch(healthUrl(), { cache: "no-store" });
      const body = (await response.json()) as Health;
      setHealth(body);
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
    const stored = window.localStorage.getItem("supplyflow.density");
    if (stored === "compact" || stored === "comfortable") setDensity(stored);
  }, [check]);

  function applyDensity(next: Density) {
    setDensity(next);
    document.documentElement.dataset.density = next;
    window.localStorage.setItem("supplyflow.density", next);
    setToast({
      message: `Table density set to ${next}. The preference is stored in this browser.`,
      tone: "success",
    });
  }

  const healthy = health?.status === "ok";

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Connection health, localisation for Indian operations and workspace display preferences. Nothing here changes backend business logic."
        actions={
          <button className="btn-outline" onClick={check} disabled={checking}>
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Recheck connection
          </button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          title="API connection"
          description="Live health probe of the FastAPI service"
          className="xl:col-span-2"
          actions={
            checking ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <Badge
                value={healthy ? "healthy" : "degraded"}
                kind="status"
              />
            )
          }
        >
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-[#FBFAF6] px-4 py-3">
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                healthy ? "bg-[#EDF4EF] text-[#2F6B4A]" : "bg-[#FBEDEC] text-[#A9443E]"
              }`}
            >
              {healthy ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {checking
                  ? "Checking the API…"
                  : healthy
                    ? "API responding normally"
                    : "API unreachable or degraded"}
              </p>
              <p className="truncate text-[11px] text-stone">{API_BASE}/health</p>
            </div>
          </div>

          <dl className="mt-4">
            <StatRow label="Application environment" value={health?.app_env ?? "—"} />
            <StatRow
              label="Database"
              value={
                health ? (
                  <span className="flex items-center justify-end gap-1.5">
                    <Database className="h-3.5 w-3.5 text-stone" />
                    {health.database.dialect} · {health.database.status === "ok" ? "connected" : health.database.status}
                  </span>
                ) : (
                  "—"
                )
              }
              tone={health?.database.status === "ok" ? "success" : "danger"}
            />
            <StatRow label="Agent workflow" value={health?.agent_workflow ?? "—"} />
            <StatRow
              label="LLM required"
              value={health ? (health.llm_required ? "Yes" : "No") : "—"}
            />
            <StatRow
              label="Execution mode"
              value={WORKFLOW_SYNC ? "Synchronous (serverless-safe)" : "Background polling"}
            />
            <StatRow label="Last probe" value={health ? dateTime(health.timestamp) : "—"} />
          </dl>
        </Card>

        <Card title="Localisation" description="Fixed for Indian operations">
          <dl>
            <StatRow
              label="Currency"
              value={
                <span className="flex items-center justify-end gap-1.5">
                  <Globe2 className="h-3.5 w-3.5 text-stone" /> INR · ₹
                </span>
              }
            />
            <StatRow label="Number format" value="en-IN (12,45,000)" />
            <StatRow label="Time zone" value="Asia/Kolkata (IST)" />
            <StatRow label="Date format" value="DD/MM/YYYY" />
            <StatRow label="Today" value={todayLabel()} />
            <StatRow label="Metric units" value="units · kg · km" />
          </dl>
          <div className="mt-4 rounded-xl bg-[#FBFAF6] px-4 py-3">
            <p className="label mb-2">Formatting preview</p>
            <div className="space-y-1.5 text-[12px]">
              <p className="flex justify-between">
                <span className="text-stone">Order value</span>
                <span className="font-medium tabular-nums">{money(1245000)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-stone">Unit price</span>
                <span className="font-medium tabular-nums">{money(4.2, { digits: 2 })}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-stone">Stock units</span>
                <span className="font-medium tabular-nums">{num(12450)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-stone">Service level</span>
                <span className="font-medium tabular-nums">{percent(0.95, 0)}</span>
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Display density" description="Applies to every data table">
          <Field label="Table density" hint="Stored in this browser only">
            <Segmented
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
              value={density}
              onChange={(value) => applyDensity(value as Density)}
            />
          </Field>
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-[#FBFAF6] px-3 py-2 text-[11px] leading-relaxed text-stone">
            <MonitorCog className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Compact density reduces row padding for laptop demonstrations where more rows need to be
            visible at once.
          </p>
        </Card>

        <Card title="Data provenance" description="What powers these numbers" className="xl:col-span-2">
          <p className="text-[13px] leading-relaxed text-stone">
            The workspace reads exclusively from the FastAPI service and its PostgreSQL database.
            Seeded sales, inventory and supplier rows are clearly labelled demonstration data for an
            Indian SME distributor; uploaded CSV files append real sales history. Purchase orders,
            transfers and disruptions are simulated planning records — no supplier is contacted and
            no payment is made.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line px-4 py-3">
              <p className="label">Forecasting</p>
              <p className="mt-1 text-[12px] text-ink">XGBoost per product</p>
              <p className="text-[11px] text-stone">Moving-average benchmark</p>
            </div>
            <div className="rounded-xl border border-line px-4 py-3">
              <p className="label">Orchestration</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink">
                <ServerCog className="h-3.5 w-3.5 text-stone" /> LangGraph · 7 agents
              </p>
              <p className="text-[11px] text-stone">No paid LLM dependency</p>
            </div>
            <div className="rounded-xl border border-line px-4 py-3">
              <p className="label">Persistence</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink">
                <Database className="h-3.5 w-3.5 text-stone" /> SQLAlchemy
              </p>
              <p className="text-[11px] text-stone">Postgres in production</p>
            </div>
          </div>
        </Card>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
