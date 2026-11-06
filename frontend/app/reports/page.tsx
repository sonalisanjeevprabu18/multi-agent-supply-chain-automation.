"use client";

import { Download } from "lucide-react";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
} from "@/components/ui";
import { downloadUrl } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { money, num, percent, timeAgo } from "@/lib/format";
import type { ReportSummary } from "@/types";

const REPORTS: Array<{ key: string; label: string; description: string }> = [
  { key: "inventory", label: "Inventory", description: "Stock, safety stock, ROP and recommendations" },
  { key: "forecasts", label: "Forecasts", description: "Every persisted demand prediction" },
  { key: "purchase_orders", label: "Purchase orders", description: "Simulated procurement recommendations" },
  { key: "transfers", label: "Warehouse transfers", description: "Inter-warehouse transfer recommendations" },
  { key: "disruptions", label: "Disruptions", description: "Simulated supplier disruption events" },
  { key: "agent_executions", label: "Agent executions", description: "Workflow execution history" },
  { key: "sales", label: "Sales history", description: "Ingested historical sales rows" },
];

export default function ReportsPage() {
  const { data, error, loading, reload } = useApi<ReportSummary>("/api/reports/summary", 60000);

  return (
    <>
      <PageHeader
        title="Reports and analytics"
        subtitle="Forecast quality, inventory exposure, procurement value, transfer activity and agent reliability — aggregated from the database on every request. CSV exports stream the underlying rows."
      />

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Forecast rows"
              value={num(data.forecasting.persisted_forecast_rows)}
              hint={`${num(data.forecasting.models_trained)} models trained`}
            />
            <MetricCard
              label="XGBoost WAPE"
              value={
                data.forecasting.avg_xgboost_wape != null
                  ? percent(data.forecasting.avg_xgboost_wape)
                  : "—"
              }
              hint={`Baseline ${data.forecasting.avg_baseline_wape != null ? percent(data.forecasting.avg_baseline_wape) : "—"}`}
              tone="success"
            />
            <MetricCard
              label="Transfer units"
              value={num(data.transfers.units)}
              hint={`${num(data.transfers.records)} records`}
              tone="brand"
            />
            <MetricCard
              label="Agent success rate"
              value={
                data.agent_statistics.success_rate != null
                  ? percent(data.agent_statistics.success_rate)
                  : "—"
              }
              hint={`${num(data.agent_statistics.executions)} executions`}
              tone="brand"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Forecast performance" description="Offline metrics persisted per product">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="muted">Models with fallback</dt>
                  <dd className="font-semibold">{num(data.forecasting.models_with_fallback)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Avg XGBoost WAPE</dt>
                  <dd className="font-semibold">
                    {data.forecasting.avg_xgboost_wape != null
                      ? percent(data.forecasting.avg_xgboost_wape)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Avg baseline WAPE</dt>
                  <dd className="font-semibold">
                    {data.forecasting.avg_baseline_wape != null
                      ? percent(data.forecasting.avg_baseline_wape)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Last trained</dt>
                  <dd className="font-semibold">
                    {data.forecasting.last_trained_at
                      ? timeAgo(data.forecasting.last_trained_at)
                      : "never"}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card title="Inventory and procurement" description="Exposure and committed spend">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="muted">Inventory value</dt>
                  <dd className="font-semibold">{money(data.totals.inventory_value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Critical SKUs</dt>
                  <dd className="font-semibold">{data.inventory.critical_products.join(", ") || "none"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Overstocked SKUs</dt>
                  <dd className="font-semibold">{data.inventory.overstocked_products.join(", ") || "none"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Pending procurement</dt>
                  <dd className="font-semibold">
                    {num(data.procurement.pending_recommendations)} ·{" "}
                    {money(data.procurement.pending_value)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Stockout risk items</dt>
                  <dd className="font-semibold">{num(data.inventory.stockout_risk_items)}</dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card title="Agent execution statistics" description="Per-agent run counts and timings">
            {data.agent_statistics.per_agent.length ? (
              <div className="-mx-5 overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th className="text-right">Completed runs</th>
                      <th className="text-right">Avg duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agent_statistics.per_agent.map((agent) => (
                      <tr key={agent.agent_name}>
                        <td className="font-medium">{agent.agent_name}</td>
                        <td className="text-right tabular-nums">{num(agent.runs)}</td>
                        <td className="text-right tabular-nums">{num(agent.avg_duration_ms, 0)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No completed agent runs yet." />
            )}
          </Card>

          <Card
            title="Downloadable CSV reports"
            description="Generated on demand from live rows"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {REPORTS.map((report) => (
                <a
                  key={report.key}
                  href={downloadUrl(report.key)}
                  className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition hover:border-brand-400"
                >
                  <span>
                    <span className="block font-medium">{report.label}</span>
                    <span className="mt-0.5 block text-xs muted">{report.description}</span>
                  </span>
                  <Download className="h-4 w-4 shrink-0 muted" />
                </a>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
