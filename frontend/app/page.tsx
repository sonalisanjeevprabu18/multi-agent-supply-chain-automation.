"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  IndianRupee,
  PackageCheck,
  ShieldAlert,
  TriangleAlert,
  WarehouseIcon,
} from "lucide-react";
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
import { DemoRunner } from "@/components/DemoRunner";
import {
  ChartLegend,
  ChartTooltip,
  DemandAreaChart,
  DonutChart,
  GRID_PROPS,
  AXIS_PROPS,
} from "@/components/charts";
import {
  Badge,
  Card,
  EmptyPanel,
  ErrorPanel,
  KpiCard,
  LoadingPanel,
  PageHeader,
  StatusDot,
} from "@/components/ui";
import { useApi } from "@/lib/useApi";
import {
  dayLabel,
  duration,
  formatDate,
  greeting,
  money,
  num,
  percent,
  timeAgo,
} from "@/lib/format";
import type {
  AgentExecution,
  ForecastResult,
  InventoryRow,
  Product,
  ReportSummary,
  Warehouse,
} from "@/types";

type AlertRow = {
  sku: string;
  product_name: string;
  warehouse_code: string;
  available_stock: number;
  reorder_point: number;
  explanation: string;
};

type Backtest = {
  sku: string;
  model: string;
  days: number;
  dates: string[];
  actual: number[];
  predicted: number[];
};

const AGENT_LABELS: Array<{ key: string; label: string }> = [
  { key: "demand_forecasting_agent", label: "Demand Forecasting" },
  { key: "inventory_optimization_agent", label: "Inventory Optimization" },
  { key: "procurement_agent", label: "Procurement" },
  { key: "supplier_disruption_agent", label: "Disruption Management" },
  { key: "decision_verification_agent", label: "Decision Verification" },
];

export default function OverviewPage() {
  const summary = useApi<ReportSummary>("/api/reports/summary", 30000);
  const alerts = useApi<Record<string, AlertRow[]>>("/api/inventory/alerts", 60000);
  const inventory = useApi<InventoryRow[]>("/api/inventory", 60000);
  const warehouses = useApi<Warehouse[]>("/api/warehouses");
  const executions = useApi<Array<Record<string, unknown>>>("/api/agents/executions?limit=1");
  const forecasts = useApi<ForecastResult[]>("/api/forecast/results");

  const [productId, setProductId] = useState<number | null>(null);

  useEffect(() => {
    if (!productId && forecasts.data?.length) setProductId(forecasts.data[0].product_id);
  }, [forecasts.data, productId]);

  const backtest = useApi<Backtest>(
    productId ? `/api/forecast/backtest/${productId}?days=30` : null,
  );

  const latestExecutionId =
    executions.data && executions.data.length > 0
      ? String(executions.data[0].execution_id)
      : null;
  const latestExecution = useApi<AgentExecution>(
    latestExecutionId ? `/api/agents/status/${latestExecutionId}` : null,
    0,
  );

  const selectedForecast = useMemo(
    () => forecasts.data?.find((row) => row.product_id === productId) ?? null,
    [forecasts.data, productId],
  );

  const demandData = useMemo(() => {
    const rows: Array<{ label: string; actual: number | null; forecast: number | null }> = [];
    if (backtest.data) {
      backtest.data.dates.forEach((date, index) => {
        rows.push({
          label: dayLabel(date),
          actual: backtest.data!.actual[index],
          forecast: null,
        });
      });
    }
    const predictions = selectedForecast?.predictions ?? [];
    if (predictions.length) {
      if (rows.length) {
        const lastActual = [...rows].reverse().find((row) => row.actual !== null);
        if (lastActual) lastActual.forecast = lastActual.actual;
      }
      predictions.forEach((point) => {
        rows.push({ label: dayLabel(point.date), actual: null, forecast: point.predicted_units });
      });
    }
    return rows;
  }, [backtest.data, selectedForecast]);

  const health = useMemo(() => {
    const counts = summary.data?.inventory.alerts;
    return [
      { name: "Healthy stock", value: counts?.ok ?? 0, color: "#4C8763" },
      { name: "Low stock", value: counts?.low ?? 0, color: "#D89A39" },
      { name: "Overstock", value: counts?.overstock ?? 0, color: "#8FA9B8" },
      { name: "Critical stock", value: counts?.critical ?? 0, color: "#C65B55" },
    ];
  }, [summary.data]);

  const warehouseData = useMemo(() => {
    const rows = inventory.data ?? [];
    return (warehouses.data ?? []).map((warehouse) => {
      const items = rows.filter((row) => row.warehouse_id === warehouse.id);
      return {
        name: warehouse.name.replace(/ (Distribution|Fulfilment|Depot)$/, ""),
        available: Math.round(items.reduce((sum, row) => sum + row.available_stock, 0)),
        capacity: warehouse.capacity,
      };
    });
  }, [inventory.data, warehouses.data]);

  const agentActivity = useMemo(() => {
    const logs = latestExecution.data?.logs ?? [];
    return AGENT_LABELS.map((agent) => {
      const entries = logs.filter((log) => log.agent_name === agent.key);
      const last = entries[entries.length - 1];
      const done = entries.some((log) => log.status === "completed");
      const failed = entries.some((log) => log.status === "failed");
      return {
        ...agent,
        status: failed ? "failed" : done ? "completed" : last ? last.status : "queued",
        duration: last?.duration_ms ?? null,
        at: last?.created_at ?? null,
      };
    });
  }, [latestExecution.data]);

  const alertList = useMemo(() => {
    const groups = alerts.data ?? {};
    const order: Array<[string, AlertRow[]]> = [
      ["critical", groups.critical ?? []],
      ["low", groups.low ?? []],
      ["overstock", groups.overstock ?? []],
      ["stockout", groups.stockout ?? []],
    ];
    return order.flatMap(([level, rows]) =>
      rows.map((row) => ({ ...row, level })),
    ).slice(0, 5);
  }, [alerts.data]);

  const pendingOrders = summary.data?.procurement.purchase_orders ?? 0;
  const pendingValue = summary.data?.procurement.pending_value ?? 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}, Welcome to SupplyFlow AI.`}
        subtitle="Your intelligent supply-chain operations overview — live stock, forecast demand, supplier exposure and agent decisions across every facility."
        aside={
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[11px] text-stone sm:flex">
            <StatusDot tone={summary.error ? "danger" : summary.data ? "ok" : "warn"} />
            {summary.error
              ? "API unreachable"
              : summary.data
                ? "Live API data"
                : "Connecting…"}
          </span>
        }
        actions={<DemoRunner />}
      />

      {summary.error ? <ErrorPanel message={summary.error} onRetry={summary.reload} /> : null}
      {summary.loading && !summary.data ? <LoadingPanel rows={3} label="Loading operations snapshot…" /> : null}

      {summary.data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Total products"
              value={num(summary.data.totals.products)}
              hint={`${num(summary.data.totals.sales_rows)} sales rows ingested`}
              icon={<Boxes className="h-4 w-4" />}
            />
            <KpiCard
              label="Inventory valuation"
              value={money(summary.data.totals.inventory_value)}
              hint={`${num(summary.data.totals.inventory_rows)} stock positions`}
              icon={<IndianRupee className="h-4 w-4" />}
              tone="brand"
            />
            <KpiCard
              label="Low stock alerts"
              value={num(summary.data.inventory.alerts.low)}
              hint={`${num(summary.data.inventory.alerts.critical)} critical · ${num(
                summary.data.inventory.alerts.overstock,
              )} overstock`}
              icon={<TriangleAlert className="h-4 w-4" />}
              tone="warning"
            />
            <KpiCard
              label="Pending purchase orders"
              value={num(pendingOrders)}
              hint={`${money(pendingValue)} recommended spend`}
              icon={<ClipboardList className="h-4 w-4" />}
            />
            <KpiCard
              label="Active disruptions"
              value={num(summary.data.disruptions.active)}
              hint={`${num(summary.data.disruptions.critical)} critical severity`}
              icon={<ShieldAlert className="h-4 w-4" />}
              tone={summary.data.disruptions.active > 0 ? "danger" : "success"}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card
              title="Demand overview"
              description={
                selectedForecast
                  ? `${selectedForecast.sku} · ${selectedForecast.product_name} · 30-day actuals with ${selectedForecast.horizon_days}-day forecast`
                  : "Backtested actuals against persisted forecasts"
              }
              className="xl:col-span-2"
              actions={
                <select
                  className="field field-sm !w-auto"
                  value={productId ?? ""}
                  onChange={(event) =>
                    setProductId(event.target.value ? Number(event.target.value) : null)
                  }
                  aria-label="Select product for demand chart"
                >
                  {(forecasts.data ?? []).map((row) => (
                    <option key={row.product_id} value={row.product_id}>
                      {row.sku}
                    </option>
                  ))}
                </select>
              }
            >
              {backtest.loading && !backtest.data ? (
                <LoadingPanel rows={5} label="Loading demand history…" />
              ) : null}
              {backtest.error ? <ErrorPanel message={backtest.error} /> : null}
              {!productId && !forecasts.loading ? (
                <EmptyPanel message="No persisted forecast yet. Train the models and generate a forecast to populate this chart." />
              ) : null}
              {demandData.length ? (
                <>
                  <DemandAreaChart data={demandData} />
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                    <ChartLegend
                      items={[
                        { label: "Actual demand", color: "#183D32" },
                        { label: "XGBoost forecast", color: "#A6C7A9", dashed: true },
                      ]}
                    />
                    <p className="text-[11px] text-stone">
                      {selectedForecast?.fallback
                        ? "Baseline fallback active for this product"
                        : `Model ${selectedForecast?.model.toUpperCase() ?? "XGBoost"} · ${num(
                            selectedForecast?.total_predicted_units ?? 0,
                          )} units forecast`}
                    </p>
                  </div>
                </>
              ) : null}
            </Card>

            <Card
              title="Inventory health"
              description="Stock positions by alert level"
            >
              {health.every((entry) => entry.value === 0) ? (
                <EmptyPanel message="No inventory positions recorded yet." />
              ) : (
                <>
                  <DonutChart
                    data={health}
                    centerValue={num(summary.data.totals.inventory_rows)}
                    centerLabel="positions"
                  />
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4">
                    {health.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: entry.color }}
                        />
                        <span className="text-[12px] text-stone">{entry.name}</span>
                        <span className="ml-auto text-[12px] font-semibold tabular-nums text-forest-900">
                          {num(entry.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card
              title="Warehouse performance"
              description="Available units against installed capacity"
              actions={
                <Link
                  href="/warehouses"
                  className="flex items-center gap-1 text-[11px] font-medium text-forest-600 hover:text-forest-800"
                >
                  All warehouses <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <ResponsiveContainer width="100%" height={236}>
                <BarChart data={warehouseData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barGap={6}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="name" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} width={48} />
                  <Tooltip
                    content={
                      <ChartTooltip formatter={(value) => `${num(value)} units`} />
                    }
                    cursor={{ fill: "rgba(24,61,50,0.04)" }}
                  />
                  <Bar dataKey="capacity" name="Capacity" fill="#E4EDE7" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="available" name="Available" fill="#315C49" radius={[6, 6, 0, 0]}>
                    {warehouseData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.available / (entry.capacity || 1) > 0.85 ? "#D89A39" : "#315C49"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[11px] text-stone">
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-forest-600" /> Available
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-forest-100" /> Capacity
                  </span>
                </span>
                <span>{num(summary.data.totals.warehouses)} facilities</span>
              </div>
            </Card>

            <Card
              title="Recent agent activity"
              description={
                latestExecution.data
                  ? `Execution ${latestExecution.data.execution_id.slice(0, 8)} · ${latestExecution.data.status}`
                  : "Waiting for the first workflow run"
              }
              className="xl:col-span-2"
              actions={
                <Link
                  href="/agents"
                  className="flex items-center gap-1 text-[11px] font-medium text-forest-600 hover:text-forest-800"
                >
                  Control center <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {latestExecution.loading && !latestExecution.data ? (
                <LoadingPanel rows={4} label="Loading agent log…" />
              ) : null}
              {!latestExecution.data ? (
                <EmptyPanel message="No workflow execution recorded yet. Run the demonstration scenario to produce real agent logs." />
              ) : (
                <ul className="divide-y divide-line">
                  {agentActivity.map((agent) => (
                    <li key={agent.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <StatusDot
                        tone={
                          agent.status === "completed"
                            ? "ok"
                            : agent.status === "failed"
                              ? "danger"
                              : agent.status === "queued"
                                ? "idle"
                                : "warn"
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">{agent.label}</p>
                        <p className="text-[11px] text-stone">
                          {agent.at ? timeAgo(agent.at) : "Not executed in this run"}
                          {agent.duration !== null ? ` · ${duration(agent.duration)}` : ""}
                        </p>
                      </div>
                      <Badge value={agent.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card
              title="Recent alerts"
              description="Derived from safety stock and reorder points"
              className="xl:col-span-2"
              actions={
                <Link
                  href="/inventory"
                  className="flex items-center gap-1 text-[11px] font-medium text-forest-600 hover:text-forest-800"
                >
                  Inventory <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              {alertList.length === 0 ? (
                <EmptyPanel message="No inventory alerts are active across the network." />
              ) : (
                <ul className="divide-y divide-line">
                  {alertList.map((row) => (
                    <li
                      key={`${row.level}-${row.sku}-${row.warehouse_code}`}
                      className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          row.level === "critical" || row.level === "stockout"
                            ? "bg-[#FBEDEC] text-[#A9443E]"
                            : row.level === "low"
                              ? "bg-[#FBF3E4] text-[#94651F]"
                              : "bg-[#EEF3F7] text-[#41637A]"
                        }`}
                      >
                        <PackageCheck className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">
                          {row.sku} · {row.product_name}
                        </p>
                        <p className="truncate text-[11px] text-stone">{row.explanation}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-semibold tabular-nums text-forest-900">
                          {num(row.available_stock)} <span className="text-stone">/</span>{" "}
                          {num(row.reorder_point)}
                        </p>
                        <p className="text-[11px] text-stone">
                          {row.warehouse_code} · ROP
                        </p>
                      </div>
                      <Badge value={row.level} kind="alert" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Forecast quality" description="Offline evaluation per product">
              <dl className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <dt className="text-[13px] text-stone">Avg XGBoost WAPE</dt>
                  <dd className="font-display text-lg font-semibold text-forest-900">
                    {summary.data.forecasting.avg_xgboost_wape != null
                      ? percent(summary.data.forecasting.avg_xgboost_wape)
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[13px] text-stone">Moving-average WAPE</dt>
                  <dd className="font-display text-lg font-semibold text-stone">
                    {summary.data.forecasting.avg_baseline_wape != null
                      ? percent(summary.data.forecasting.avg_baseline_wape)
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[13px] text-stone">Models trained</dt>
                  <dd className="text-[13px] font-semibold text-forest-900">
                    {num(summary.data.forecasting.models_trained)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[13px] text-stone">Sales window</dt>
                  <dd className="text-[13px] font-medium text-forest-900">
                    {summary.data.sales_history.date_range
                      ? `${formatDate(summary.data.sales_history.date_range[0])} – ${formatDate(
                          summary.data.sales_history.date_range[1],
                        )}`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 rounded-lg bg-[#FBFAF6] px-3 py-2 text-[11px] leading-relaxed text-stone">
                Source: {summary.data.data_source}. Seeded rows are clearly-labelled demonstration
                data; uploaded CSVs append real records.
              </p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-stone">
                <span className="flex items-center gap-1.5">
                  <WarehouseIcon className="h-3.5 w-3.5" />
                  {num(summary.data.totals.warehouses)} warehouses
                </span>
                <span>{num(summary.data.totals.active_suppliers)} active suppliers</span>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
