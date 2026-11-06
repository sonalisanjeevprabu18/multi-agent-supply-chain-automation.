"use client";

import Link from "next/link";
import {
  AlertOctagon,
  ArrowUpRight,
  Boxes,
  ClipboardList,
  PackageCheck,
  Radio,
  Truck,
  Warehouse,
} from "lucide-react";
import { DemoRunner } from "@/components/DemoRunner";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
} from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { money, num, timeAgo } from "@/lib/format";
import type { ReportSummary } from "@/types";

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<ReportSummary>("/api/reports/summary", 30000);
  const executions = useApi<Array<Record<string, unknown>>>("/api/agents/executions?limit=5");

  return (
    <>
      <PageHeader
        title="Executive control tower"
        subtitle="Live supply-chain position across warehouses, demand forecasts, procurement and agent activity. Every figure is read from the API and backed by database rows."
        actions={<DemoRunner />}
      />

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Products"
              value={num(data.totals.products)}
              hint={`${num(data.totals.sales_rows)} sales rows`}
              icon={<Boxes className="h-4 w-4" />}
            />
            <MetricCard
              label="Warehouses"
              value={num(data.totals.warehouses)}
              hint={`${num(data.totals.active_suppliers)} active suppliers`}
              icon={<Warehouse className="h-4 w-4" />}
            />
            <MetricCard
              label="Inventory value"
              value={money(data.totals.inventory_value)}
              hint="On-hand units at product cost"
              tone="brand"
              icon={<PackageCheck className="h-4 w-4" />}
            />
            <MetricCard
              label="Low stock"
              value={num(data.inventory.alerts.low)}
              hint={`${num(data.inventory.alerts.critical)} critical / stockout`}
              tone="warning"
              icon={<AlertOctagon className="h-4 w-4" />}
            />
            <MetricCard
              label="Overstocked"
              value={num(data.inventory.alerts.overstock)}
              hint={`${num(data.inventory.stockout_risk_items)} items at stockout risk`}
              icon={<Boxes className="h-4 w-4" />}
            />
            <MetricCard
              label="Pending procurement"
              value={num(data.procurement.pending_recommendations)}
              hint={`${money(data.procurement.pending_value)} recommended spend`}
              icon={<ClipboardList className="h-4 w-4" />}
            />
            <MetricCard
              label="Active disruptions"
              value={num(data.disruptions.active)}
              hint={`${num(data.disruptions.by_severity.critical ?? 0)} critical severity`}
              tone="danger"
              icon={<Truck className="h-4 w-4" />}
            />
            <MetricCard
              label="Agent executions"
              value={num(data.agent_statistics.executions)}
              hint={`${data.agent_statistics.completed} completed · ${data.agent_statistics.failed} failed`}
              tone="brand"
              icon={<Radio className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card
              title="Recent agent executions"
              description="Latest LangGraph runs persisted in agent_executions"
              className="xl:col-span-2"
              actions={
                <Link href="/agents" className="text-xs font-semibold text-brand-600">
                  Open monitoring
                </Link>
              }
            >
              {executions.loading && !executions.data ? <LoadingState label="Loading runs…" /> : null}
              {executions.error ? <ErrorState message={executions.error} /> : null}
              {executions.data && executions.data.length === 0 ? (
                <EmptyState message="No workflow has been executed yet. Run the demonstration scenario." />
              ) : null}
              {executions.data && executions.data.length > 0 ? (
                <div className="-mx-5 overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Scenario</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Transfers</th>
                        <th>Orders</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {executions.data.map((row) => {
                        const summary = (row.summary || {}) as Record<string, unknown>;
                        const id = String(row.execution_id);
                        return (
                          <tr key={id}>
                            <td className="font-medium">{String(row.scenario)}</td>
                            <td>
                              <Badge value={String(row.status)} />
                            </td>
                            <td className="muted text-xs">{timeAgo(row.started_at as string)}</td>
                            <td className="tabular-nums">{num(Number(summary.transfers ?? 0))}</td>
                            <td className="tabular-nums">{num(Number(summary.purchase_orders ?? 0))}</td>
                            <td className="text-right">
                              <Link
                                href={`/agents?execution=${id}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600"
                              >
                                timeline <ArrowUpRight className="h-3 w-3" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>

            <Card title="Inventory alerts" description="Derived from safety stock and reorder points">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="muted">Critical / stockout</dt>
                  <dd className="font-semibold">{num(data.inventory.alerts.critical)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="muted">Low stock</dt>
                  <dd className="font-semibold">{num(data.inventory.alerts.low)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="muted">Overstock</dt>
                  <dd className="font-semibold">{num(data.inventory.alerts.overstock)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="muted">Replenishment needs</dt>
                  <dd className="font-semibold">{num(data.inventory.replenishment_required)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="muted">Recommended order units</dt>
                  <dd className="font-semibold">{num(data.inventory.recommended_order_units)}</dd>
                </div>
              </dl>
              <div className="mt-4 space-y-2 text-xs muted">
                <p>
                  Critical SKUs: {data.inventory.critical_products.join(", ") || "none"}
                </p>
                <p>Overstocked SKUs: {data.inventory.overstocked_products.join(", ") || "none"}</p>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Card title="Demand modelling" description="Offline XGBoost versus moving-average baseline">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="muted">Models trained</dt>
                  <dd className="font-semibold">{num(data.forecasting.models_trained)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Avg XGBoost WAPE</dt>
                  <dd className="font-semibold">
                    {data.forecasting.avg_xgboost_wape !== null
                      ? `${(data.forecasting.avg_xgboost_wape * 100).toFixed(1)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Avg baseline WAPE</dt>
                  <dd className="font-semibold">
                    {data.forecasting.avg_baseline_wape !== null
                      ? `${(data.forecasting.avg_baseline_wape * 100).toFixed(1)}%`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </Card>
            <Card title="Procurement" description="Simulated purchase-order recommendations">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="muted">Orders on file</dt>
                  <dd className="font-semibold">{num(data.procurement.purchase_orders)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Pending value</dt>
                  <dd className="font-semibold">{money(data.procurement.pending_value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="muted">Transfers recorded</dt>
                  <dd className="font-semibold">{num(data.transfers.records)}</dd>
                </div>
              </dl>
            </Card>
            <Card title="Data provenance" description="What backs these numbers">
              <p className="text-sm muted">
                {num(data.totals.sales_rows)} sales rows
                {data.sales_history.date_range
                  ? ` from ${data.sales_history.date_range[0]} to ${data.sales_history.date_range[1]}`
                  : ""}.
              </p>
              <p className="mt-3 text-xs muted">
                Source: {data.data_source}. Seeded rows are synthetic demonstration data;
                CSV uploads append real records. Purchase orders and disruptions are simulated.
              </p>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
