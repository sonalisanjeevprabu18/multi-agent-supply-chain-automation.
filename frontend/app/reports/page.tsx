"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  Badge,
  Card,
  EmptyPanel,
  ErrorPanel,
  KpiCard,
  LoadingPanel,
  PageHeader,
  StatRow,
  TableWrap,
} from "@/components/ui";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS } from "@/components/charts";
import { downloadUrl } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { formatDate, money, moneyCompact, num, percent } from "@/lib/format";
import type {
  InventoryRow,
  PurchaseOrder,
  ReportSummary,
  Supplier,
  Warehouse,
} from "@/types";

const REPORTS = [
  { key: "inventory", label: "Inventory", description: "Stock, safety stock, ROP and recommendations" },
  { key: "forecasts", label: "Forecasts", description: "Every persisted demand prediction" },
  { key: "purchase_orders", label: "Purchase orders", description: "Simulated procurement recommendations" },
  { key: "transfers", label: "Warehouse transfers", description: "Inter-warehouse transfer recommendations" },
  { key: "disruptions", label: "Disruptions", description: "Simulated supplier disruption events" },
  { key: "agent_executions", label: "Agent executions", description: "Workflow execution history" },
  { key: "sales", label: "Sales history", description: "Ingested historical sales rows" },
];

export default function ReportsPage() {
  const summary = useApi<ReportSummary>("/api/reports/summary", 60000);
  const suppliers = useApi<Supplier[]>("/api/suppliers");
  const inventory = useApi<InventoryRow[]>("/api/inventory");
  const warehouses = useApi<Warehouse[]>("/api/warehouses");
  const orders = useApi<PurchaseOrder[]>("/api/procurement/orders");

  const alertData = useMemo(() => {
    const alerts = summary.data?.inventory.alerts;
    if (!alerts) return [];
    return [
      { name: "Critical", value: alerts.critical, color: "#C65B55" },
      { name: "Low", value: alerts.low, color: "#D89A39" },
      { name: "Overstock", value: alerts.overstock, color: "#8FA9B8" },
      { name: "Healthy", value: alerts.ok, color: "#4C8763" },
    ];
  }, [summary.data]);

  const supplierReliability = useMemo(
    () =>
      (suppliers.data ?? [])
        .map((supplier) => {
          const offers = supplier.offers;
          const average = offers.length
            ? offers.reduce((sum, offer) => sum + offer.reliability_score, 0) / offers.length
            : 0;
          return {
            name: supplier.name.replace(/( Pvt| Private| Industries| Industrial| Supplies| Trading| Logistics).*/g, ""),
            reliability: Number((average * 100).toFixed(1)),
            supplier,
          };
        })
        .sort((a, b) => b.reliability - a.reliability)
        .slice(0, 6),
    [suppliers.data],
  );

  const warehouseEfficiency = useMemo(() => {
    const rows = inventory.data ?? [];
    return (warehouses.data ?? []).map((warehouse) => {
      const items = rows.filter((row) => row.warehouse_id === warehouse.id);
      const available = items.reduce((sum, row) => sum + row.available_stock, 0);
      return {
        name: warehouse.name.replace(/ (Distribution|Fulfilment|Depot)$/, ""),
        utilization: warehouse.capacity
          ? Number(((available / warehouse.capacity) * 100).toFixed(1))
          : 0,
      };
    });
  }, [inventory.data, warehouses.data]);

  const procurementBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    (orders.data ?? []).forEach((order) => {
      map.set(order.supplier_name, (map.get(order.supplier_name) ?? 0) + order.total_cost);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({
        name: name.replace(/( Pvt| Private| Industries| Industrial| Supplies| Trading| Logistics).*/g, ""),
        value: Math.round(value),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [orders.data]);

  const agentPerformance = useMemo(
    () =>
      (summary.data?.agent_statistics.per_agent ?? []).map((agent) => ({
        name: agent.agent_name.replace(/_agent$/, "").replace(/_/g, " "),
        duration: Math.round(agent.avg_duration_ms),
        runs: agent.runs,
      })),
    [summary.data],
  );

  const totalInventoryValue = summary.data?.totals.inventory_value ?? 0;

  return (
    <>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Forecast quality, inventory exposure, procurement spend, supplier reliability and agent performance — aggregated from database rows on every request."
        actions={
          <a href={downloadUrl("inventory")} className="btn-primary">
            <Download className="h-4 w-4" /> Export inventory CSV
          </a>
        }
      />

      {summary.error ? <ErrorPanel message={summary.error} onRetry={summary.reload} /> : null}
      {summary.loading && !summary.data ? <LoadingPanel rows={4} /> : null}

      {summary.data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Inventory valuation"
              value={money(totalInventoryValue)}
              hint={`${num(summary.data.totals.inventory_rows)} stock positions`}
              tone="brand"
            />
            <KpiCard
              label="Avg XGBoost WAPE"
              value={
                summary.data.forecasting.avg_xgboost_wape != null
                  ? percent(summary.data.forecasting.avg_xgboost_wape)
                  : "—"
              }
              hint={`Baseline ${
                summary.data.forecasting.avg_baseline_wape != null
                  ? percent(summary.data.forecasting.avg_baseline_wape)
                  : "—"
              }`}
              tone="success"
            />
            <KpiCard
              label="Pending procurement"
              value={money(summary.data.procurement.pending_value)}
              hint={`${num(summary.data.procurement.purchase_orders)} orders on record`}
              tone="warning"
            />
            <KpiCard
              label="Agent success rate"
              value={
                summary.data.agent_statistics.success_rate != null
                  ? percent(summary.data.agent_statistics.success_rate, 0)
                  : "—"
              }
              hint={`${num(summary.data.agent_statistics.executions)} executions · ${num(
                summary.data.agent_statistics.agent_logs,
              )} log rows`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Stockout exposure" description="Current stock positions by alert level">
              {alertData.length ? (
                <>
                  <ResponsiveContainer width="100%" height={244}>
                    <BarChart data={alertData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="name" {...AXIS_PROPS} />
                      <YAxis {...AXIS_PROPS} width={44} />
                      <Tooltip
                        cursor={{ fill: "rgba(24,61,50,0.04)" }}
                        content={<ChartTooltip formatter={(value) => `${num(value)} positions`} />}
                      />
                      <Bar dataKey="value" name="Positions" radius={[6, 6, 0, 0]}>
                        {alertData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-stone">
                    {num(summary.data.inventory.stockout_risk_items)} positions sit at stockout risk
                    and {num(summary.data.inventory.replenishment_required)} need replenishment
                    ({num(summary.data.inventory.recommended_order_units)} units). A historical
                    stockout time series is not persisted, so this is a current snapshot rather than
                    a trend line.
                  </p>
                </>
              ) : (
                <EmptyPanel message="No inventory positions recorded yet." />
              )}
            </Card>

            <Card title="Procurement expenditure" description="Committed order value by supplier">
              {procurementBySupplier.length ? (
                <>
                  <ResponsiveContainer width="100%" height={244}>
                    <BarChart
                      data={procurementBySupplier}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                      <XAxis
                        type="number"
                        {...AXIS_PROPS}
                        tickFormatter={(value: number) => moneyCompact(value).replace("₹", "")}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        {...AXIS_PROPS}
                        width={96}
                        tick={{ fontSize: 10, fill: "#858D87" }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(24,61,50,0.04)" }}
                        content={<ChartTooltip formatter={(value) => money(value)} />}
                      />
                      <Bar dataKey="value" name="Order value" fill="#315C49" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                    <ChartLegend items={[{ label: "Committed order value (₹)", color: "#315C49" }]} />
                    <span className="text-[11px] text-stone">
                      {num(orders.data?.length ?? 0)} orders
                    </span>
                  </div>
                </>
              ) : (
                <EmptyPanel message="No purchase orders recorded. Generate recommendations from the procurement workspace." />
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Supplier reliability" description="Average on-time delivery score">
              {supplierReliability.length ? (
                <ul className="space-y-3">
                  {supplierReliability.map((entry) => (
                    <li key={entry.name}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] text-ink">{entry.name}</span>
                        <span className="text-[12px] font-semibold tabular-nums text-forest-900">
                          {entry.reliability.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#EEEDE6]">
                        <div
                          className="h-full rounded-full bg-forest-500"
                          style={{ width: `${Math.min(100, entry.reliability)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <LoadingPanel rows={4} />
              )}
            </Card>

            <Card title="Warehouse efficiency" description="Capacity utilisation by facility">
              {warehouseEfficiency.length ? (
                <ul className="space-y-3">
                  {warehouseEfficiency.map((entry) => (
                    <li key={entry.name}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] text-ink">{entry.name}</span>
                        <span className="text-[12px] font-semibold tabular-nums text-forest-900">
                          {entry.utilization.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#EEEDE6]">
                        <div
                          className={`h-full rounded-full ${
                            entry.utilization > 90
                              ? "bg-danger"
                              : entry.utilization > 80
                                ? "bg-warn"
                                : "bg-forest-500"
                          }`}
                          style={{ width: `${Math.min(100, entry.utilization)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <LoadingPanel rows={3} />
              )}
            </Card>

            <Card title="Operations snapshot" description="Everything currently in the database">
              <dl>
                <StatRow label="Products" value={num(summary.data.totals.products)} />
                <StatRow label="Suppliers" value={num(summary.data.totals.suppliers)} />
                <StatRow label="Active suppliers" value={num(summary.data.totals.active_suppliers)} />
                <StatRow label="Transfers" value={`${num(summary.data.transfers.records)} · ${num(summary.data.transfers.units)} u`} />
                <StatRow label="Disruptions" value={num(summary.data.disruptions.active)} tone="danger" />
                <StatRow
                  label="Sales window"
                  value={
                    summary.data.sales_history.date_range
                      ? `${formatDate(summary.data.sales_history.date_range[0])} – ${formatDate(
                          summary.data.sales_history.date_range[1],
                        )}`
                      : "—"
                  }
                />
              </dl>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Agent execution performance" description="Average duration per agent">
              {agentPerformance.length ? (
                <>
                  <ResponsiveContainer width="100%" height={264}>
                    <BarChart
                      data={agentPerformance}
                      layout="vertical"
                      margin={{ top: 4, right: 20, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                      <XAxis type="number" {...AXIS_PROPS} tickFormatter={(value: number) => `${value}`} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        {...AXIS_PROPS}
                        width={130}
                        tick={{ fontSize: 10, fill: "#858D87" }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(24,61,50,0.04)" }}
                        content={<ChartTooltip formatter={(value) => `${num(value)} ms`} />}
                      />
                      <Bar dataKey="duration" name="Avg duration" fill="#183D32" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="mt-3 border-t border-line pt-3 text-[11px] text-stone">
                    {num(summary.data.agent_statistics.executions)} executions ·{" "}
                    {num(summary.data.agent_statistics.completed)} completed ·{" "}
                    {num(summary.data.agent_statistics.failed)} failed · average run{" "}
                    {summary.data.agent_statistics.avg_execution_seconds != null
                      ? `${num(summary.data.agent_statistics.avg_execution_seconds, 2)} s`
                      : "—"}
                  </p>
                </>
              ) : (
                <EmptyPanel message="No completed agent runs yet." />
              )}
            </Card>

            <Card
              title="Agent statistics"
              description="Runs and timings per specialised agent"
              bodyClassName="pb-2"
            >
              {summary.data.agent_statistics.per_agent.length ? (
                <TableWrap>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th className="text-right">Runs</th>
                        <th className="text-right">Avg duration</th>
                        <th>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.agent_statistics.per_agent.map((agent) => (
                        <tr key={agent.agent_name}>
                          <td className="text-[12px] font-medium">
                            {agent.agent_name.replace(/_/g, " ")}
                          </td>
                          <td className="text-right tabular-nums">{num(agent.runs)}</td>
                          <td className="text-right tabular-nums">
                            {num(agent.avg_duration_ms)} ms
                          </td>
                          <td>
                            <Badge value={agent.agent_name.replace(/_agent$/, "").split("_").slice(-1)[0]} kind="outline" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <div className="p-5">
                  <EmptyPanel message="No completed agent runs yet." />
                </div>
              )}
            </Card>
          </div>

          <Card
            title="CSV exports"
            description="Generated on demand from live rows"
            actions={
              <span className="flex items-center gap-1.5 text-[11px] text-stone">
                <FileSpreadsheet className="h-3.5 w-3.5" /> UTF-8 CSV
              </span>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {REPORTS.map((report) => (
                <a
                  key={report.key}
                  href={downloadUrl(report.key)}
                  className="group flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3 transition hover:border-forest-300 hover:bg-forest-50/60"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{report.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-stone">
                      {report.description}
                    </span>
                  </span>
                  <Download className="h-4 w-4 shrink-0 text-stone transition group-hover:text-forest-700" />
                </a>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-stone">
              Exports stream the same rows the dashboard reads. Monetary columns are stored as
              numeric values in Indian Rupees.
            </p>
          </Card>
        </div>
      ) : null}
    </>
  );
}
