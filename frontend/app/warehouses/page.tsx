"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeftRight, MapPin, Package, Warehouse as WarehouseIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Card,
  EmptyPanel,
  ErrorPanel,
  KpiCard,
  LoadingPanel,
  PageHeader,
  Progress,
  TableWrap,
} from "@/components/ui";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS } from "@/components/charts";
import { useApi } from "@/lib/useApi";
import { formatDate, money, moneyCompact, num } from "@/lib/format";
import type { InventoryRow, Product, ReportSummary, Warehouse } from "@/types";

type Transfer = {
  id: number;
  sku: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  quantity: number;
  feasible: boolean;
  status: string;
  reason: string;
};

export default function WarehousesPage() {
  const warehouses = useApi<Warehouse[]>("/api/warehouses");
  const inventory = useApi<InventoryRow[]>("/api/inventory");
  const products = useApi<Product[]>("/api/products");
  const transfers = useApi<Transfer[]>("/api/inventory/transfers");
  const summary = useApi<ReportSummary>("/api/reports/summary");

  const costByProduct = useMemo(() => {
    const map = new Map<number, number>();
    (products.data ?? []).forEach((product) => map.set(product.id, product.unit_cost));
    return map;
  }, [products.data]);

  const facilities = useMemo(() => {
    const rows = inventory.data ?? [];
    return (warehouses.data ?? []).map((warehouse) => {
      const items = rows.filter((row) => row.warehouse_id === warehouse.id);
      const available = items.reduce((sum, row) => sum + row.available_stock, 0);
      const valuation = items.reduce(
        (sum, row) => sum + row.available_stock * (costByProduct.get(row.product_id) ?? 0),
        0,
      );
      const alerts = items.filter((row) => row.alert_level !== "ok").length;
      const inbound = (transfers.data ?? []).filter(
        (transfer) => transfer.to_warehouse_name === warehouse.name,
      );
      const outbound = (transfers.data ?? []).filter(
        (transfer) => transfer.from_warehouse_name === warehouse.name,
      );
      return {
        ...warehouse,
        skus: new Set(items.map((row) => row.product_id)).size,
        available,
        valuation,
        alerts,
        inbound: inbound.reduce((sum, transfer) => sum + transfer.quantity, 0),
        outbound: outbound.reduce((sum, transfer) => sum + transfer.quantity, 0),
        utilization: warehouse.capacity ? (available / warehouse.capacity) * 100 : 0,
      };
    });
  }, [warehouses.data, inventory.data, costByProduct, transfers.data]);

  const chartData = facilities.map((facility) => ({
    name: facility.name.replace(/ (Distribution|Fulfilment|Depot)$/, ""),
    available: Math.round(facility.available),
    capacity: facility.capacity,
  }));

  const totalValue = facilities.reduce((sum, facility) => sum + facility.valuation, 0);
  const totalUnits = facilities.reduce((sum, facility) => sum + facility.available, 0);
  const averageUtilisation = facilities.length
    ? facilities.reduce((sum, facility) => sum + facility.utilization, 0) / facilities.length
    : 0;

  return (
    <>
      <PageHeader
        title="Warehouse Operations"
        subtitle="Capacity, inventory valuation and inter-facility transfer activity for every distribution centre in the network."
        actions={
          <Link href="/inventory" className="btn-outline">
            <Package className="h-4 w-4" /> Open inventory
          </Link>
        }
      />

      {warehouses.error ? <ErrorPanel message={warehouses.error} onRetry={warehouses.reload} /> : null}
      {warehouses.loading && !warehouses.data ? <LoadingPanel rows={3} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Facilities"
          value={num(facilities.length)}
          hint={`${num(facilities.reduce((sum, item) => sum + item.skus, 0))} SKU positions`}
          icon={<WarehouseIcon className="h-4 w-4" />}
        />
        <KpiCard
          label="Network valuation"
          value={money(totalValue)}
          hint={`${num(totalUnits)} available units`}
          tone="brand"
        />
        <KpiCard
          label="Average utilisation"
          value={`${averageUtilisation.toFixed(0)}%`}
          hint="Available units ÷ installed capacity"
          tone={averageUtilisation > 85 ? "warning" : "success"}
        />
        <KpiCard
          label="Transfer activity"
          value={num(transfers.data?.length ?? 0)}
          hint={`${num(
            (transfers.data ?? []).reduce((sum, item) => sum + item.quantity, 0),
          )} units moved or planned`}
        />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {facilities.map((facility) => (
          <div key={facility.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-[15px] font-semibold text-forest-900">
                  {facility.name}
                </p>
                <p className="mt-1 flex items-center gap-1 text-[12px] text-stone">
                  <MapPin className="h-3.5 w-3.5" />
                  {facility.location}
                </p>
              </div>
              <Badge value={facility.code} kind="outline" />
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Capacity utilisation</span>
                <span className="text-[12px] font-semibold tabular-nums text-forest-900">
                  {facility.utilization.toFixed(0)}%
                </span>
              </div>
              <Progress
                value={facility.utilization}
                tone={facility.utilization > 90 ? "danger" : facility.utilization > 80 ? "warn" : "forest"}
              />
              <p className="mt-1 text-[11px] text-stone">
                {num(facility.available)} of {num(facility.capacity)} units
              </p>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
              <div>
                <dt className="label">Valuation</dt>
                <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-forest-900">
                  {money(facility.valuation)}
                </dd>
              </div>
              <div>
                <dt className="label">Products</dt>
                <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-forest-900">
                  {num(facility.skus)}
                </dd>
              </div>
              <div>
                <dt className="label">Inbound</dt>
                <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-forest-900">
                  {num(facility.inbound)} <span className="text-[11px] text-stone">units</span>
                </dd>
              </div>
              <div>
                <dt className="label">Outbound</dt>
                <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-forest-900">
                  {num(facility.outbound)} <span className="text-[11px] text-stone">units</span>
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="text-[11px] text-stone">{num(facility.alerts)} active alerts</span>
              <Link
                href={`/inventory?warehouse=${facility.id}`}
                className="text-[11px] font-medium text-forest-600 hover:text-forest-800"
              >
                View stock →
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card
          title="Warehouse comparison"
          description="Available stock against installed capacity"
          className="xl:col-span-2"
        >
          {chartData.length ? (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={8}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="name" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} width={54} tickFormatter={(value: number) => moneyCompact(value).replace("₹", "")} />
                  <Tooltip
                    cursor={{ fill: "rgba(24,61,50,0.04)" }}
                    content={<ChartTooltip formatter={(value) => `${num(value)} units`} />}
                  />
                  <Bar dataKey="capacity" name="Capacity" fill="#E4EDE7" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="available" name="Available" fill="#315C49" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <ChartLegend
                  items={[
                    { label: "Available units", color: "#315C49" },
                    { label: "Installed capacity", color: "#E4EDE7" },
                  ]}
                />
                <span className="text-[11px] text-stone">Metric units · base units</span>
              </div>
            </>
          ) : (
            <EmptyPanel message="No warehouse stock recorded yet." />
          )}
        </Card>

        <Card title="Network notes" description="Derived from live stock rows">
          <dl className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <dt className="text-[13px] text-stone">Transfer records</dt>
              <dd className="text-[13px] font-semibold text-forest-900">
                {num(transfers.data?.length ?? 0)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <dt className="text-[13px] text-stone">Units in transfer</dt>
              <dd className="text-[13px] font-semibold text-forest-900">
                {num((transfers.data ?? []).reduce((sum, item) => sum + item.quantity, 0))}
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <dt className="text-[13px] text-stone">Stockout risk items</dt>
              <dd className="text-[13px] font-semibold text-[#A9443E]">
                {num(summary.data?.inventory.stockout_risk_items ?? 0)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-[13px] text-stone">Sales window</dt>
              <dd className="text-[13px] font-medium text-forest-900">
                {summary.data?.sales_history.date_range
                  ? `${formatDate(summary.data.sales_history.date_range[0])} – ${formatDate(
                      summary.data.sales_history.date_range[1],
                    )}`
                  : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 rounded-lg bg-[#FBFAF6] px-3 py-2 text-[11px] leading-relaxed text-stone">
            Locations reflect the seeded demonstration network. Capacity is stored per facility and
            utilisation compares available units against it.
          </p>
        </Card>
      </div>

      <Card
        className="mt-6"
        title="Transfer activity"
        description="Inter-warehouse movements recommended by the logistics stage"
        actions={<ArrowLeftRight className="h-4 w-4 text-stone" />}
        bodyClassName="pb-2"
      >
        {transfers.loading && !transfers.data ? <LoadingPanel rows={3} /> : null}
        {transfers.data && transfers.data.length === 0 ? (
          <EmptyPanel message="No transfers recorded. Run the workflow to plan a transfer from live stock." />
        ) : null}
        {transfers.data?.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>SKU</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="text-right">Quantity</th>
                  <th>Status</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {transfers.data.map((transfer) => (
                  <tr key={transfer.id}>
                    <td className="tabular-nums text-[12px] text-stone">TR-{transfer.id}</td>
                    <td className="font-medium">{transfer.sku}</td>
                    <td className="text-[12px]">{transfer.from_warehouse_name}</td>
                    <td className="text-[12px]">{transfer.to_warehouse_name}</td>
                    <td className="text-right tabular-nums">{num(transfer.quantity)}</td>
                    <td>
                      <Badge value={transfer.feasible ? "feasible" : "partial"} />
                    </td>
                    <td className="max-w-[280px] text-[11px] text-stone">{transfer.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>
    </>
  );
}
