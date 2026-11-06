"use client";

import { useMemo, useState } from "react";
import { Calculator, ArrowLeftRight } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  Toast,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { num } from "@/lib/format";
import type { InventoryRow, Warehouse } from "@/types";

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

export default function InventoryPage() {
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [alertFilter, setAlertFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const warehouses = useApi<Warehouse[]>("/api/warehouses");
  const inventory = useApi<InventoryRow[]>(
    `/api/inventory${warehouseId ? `?warehouse_id=${warehouseId}` : ""}`,
  );
  const transfers = useApi<Transfer[]>("/api/inventory/transfers");

  const rows = useMemo(() => {
    const data = inventory.data ?? [];
    if (alertFilter === "all") return data;
    if (alertFilter === "critical")
      return data.filter((row) => ["critical", "stockout"].includes(row.alert_level));
    return data.filter((row) => row.alert_level === alertFilter);
  }, [inventory.data, alertFilter]);

  const totals = useMemo(() => {
    const data = inventory.data ?? [];
    return {
      units: data.reduce((sum, row) => sum + row.available_stock, 0),
      safety: data.reduce((sum, row) => sum + row.safety_stock, 0),
      orderUnits: data.reduce((sum, row) => sum + row.recommended_order_quantity, 0),
      alerts: data.filter((row) => row.alert_level !== "ok").length,
    };
  }, [inventory.data]);

  async function recalculate() {
    setBusy(true);
    try {
      const response = await apiPost<{ summary: Record<string, number> }>(
        "/api/inventory/optimize",
        { service_level: 0.95, review_period_days: 7 },
      );
      inventory.reload?.();
      setToast({
        message: `Recomputed ${response.summary.items_evaluated} rows; ${response.summary.replenishment_required} need replenishment.`,
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Optimization failed.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory management"
        subtitle="Multi-warehouse stock with computed safety stock, reorder points and recommended order quantities. Demand comes from the persisted forecasts, distributed across warehouses by historical share."
        actions={
          <button className="btn-primary" onClick={recalculate} disabled={busy}>
            <Calculator className="h-4 w-4" />
            {busy ? "Optimizing…" : "Run optimization"}
          </button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Available units" value={num(totals.units)} hint="Current minus reserved" />
        <MetricCard label="Safety stock held" value={num(totals.safety)} hint="Across selected warehouses" />
        <MetricCard
          label="Recommended order units"
          value={num(totals.orderUnits)}
          hint="Target − available − incoming"
          tone="brand"
        />
        <MetricCard
          label="Active alerts"
          value={num(totals.alerts)}
          hint="Critical, low and overstock rows"
          tone="warning"
        />
      </div>

      <Card
        title="Stock position"
        description="Available = current − reserved · ROP = avg daily demand × lead time + safety stock"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="field !w-auto"
              value={warehouseId}
              onChange={(event) =>
                setWarehouseId(event.target.value ? Number(event.target.value) : "")
              }
            >
              <option value="">All warehouses</option>
              {(warehouses.data ?? []).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </select>
            <select
              className="field !w-auto"
              value={alertFilter}
              onChange={(event) => setAlertFilter(event.target.value)}
            >
              <option value="all">All levels</option>
              <option value="critical">Critical / stockout</option>
              <option value="low">Low</option>
              <option value="overstock">Overstock</option>
              <option value="ok">Healthy</option>
            </select>
          </div>
        }
      >
        {inventory.loading && !inventory.data ? <LoadingState /> : null}
        {inventory.error ? <ErrorState message={inventory.error} onRetry={inventory.reload} /> : null}
        {inventory.data && rows.length === 0 ? (
          <EmptyState message="No inventory rows match the current filter." />
        ) : null}
        {rows.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Warehouse</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Incoming</th>
                  <th className="text-right">Daily demand</th>
                  <th className="text-right">Safety</th>
                  <th className="text-right">ROP</th>
                  <th className="text-right">Order qty</th>
                  <th className="text-right">Cover</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.product_id}-${row.warehouse_id}`}>
                    <td>
                      <p className="font-medium">{row.sku}</p>
                      <p className="text-xs muted">{row.product_name}</p>
                    </td>
                    <td className="text-xs">{row.warehouse_code}</td>
                    <td className="text-right tabular-nums">{num(row.available_stock)}</td>
                    <td className="text-right tabular-nums">{num(row.incoming_stock)}</td>
                    <td className="text-right tabular-nums">{num(row.avg_daily_demand, 1)}</td>
                    <td className="text-right tabular-nums">{num(row.safety_stock)}</td>
                    <td className="text-right tabular-nums">{num(row.reorder_point)}</td>
                    <td className="text-right font-semibold tabular-nums">
                      {row.recommended_order_quantity > 0
                        ? num(row.recommended_order_quantity)
                        : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {row.days_of_cover === null ? "—" : `${num(row.days_of_cover, 1)}d`}
                    </td>
                    <td>
                      <Badge value={row.alert_level} kind="alert" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Warehouse transfer recommendations"
          description="Sources never drop below their own safety stock"
          actions={<ArrowLeftRight className="h-4 w-4 muted" />}
        >
          {transfers.loading && !transfers.data ? <LoadingState label="Loading transfers…" /> : null}
          {transfers.error ? <ErrorState message={transfers.error} /> : null}
          {transfers.data && transfers.data.length === 0 ? (
            <EmptyState message="No transfer recommended yet. Run the demonstration scenario to generate one." />
          ) : null}
          {transfers.data && transfers.data.length > 0 ? (
            <div className="-mx-5 max-h-80 overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>From → To</th>
                    <th className="text-right">Qty</th>
                    <th>Feasible</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.data.map((transfer) => (
                    <tr key={transfer.id}>
                      <td className="font-medium">{transfer.sku}</td>
                      <td className="text-xs">
                        {transfer.from_warehouse_name} → {transfer.to_warehouse_name}
                      </td>
                      <td className="text-right tabular-nums">{num(transfer.quantity)}</td>
                      <td>
                        <Badge value={transfer.feasible ? "feasible" : "partial"} kind="plain" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card title="Why these numbers" description="Documented assumptions behind the engine">
          <ul className="space-y-2 text-sm muted">
            <li>• Safety stock = Z(service level) × σ(daily demand) × √lead time.</li>
            <li>• Lead time is taken from the fastest active supplier for the product.</li>
            <li>• Target stock covers lead time plus the 7-day review period.</li>
            <li>• Recommended order = max(target − available − incoming, 0), rounded up to the MOQ.</li>
            <li>• Units are base units; all lead times and review periods are calendar days.</li>
          </ul>
        </Card>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
