"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Calculator,
  Loader2,
  PackageSearch,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  Badge,
  Card,
  EmptyPanel,
  ErrorPanel,
  KpiCard,
  LoadingPanel,
  PageHeader,
  Progress,
  SortHeader,
  TableWrap,
  Toast,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ALERT_LABELS, money, num } from "@/lib/format";
import type { InventoryRow, Product, Warehouse } from "@/types";

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

type SortKey = "sku" | "available" | "cover" | "order";

const ALERT_FILTERS = [
  { value: "all", label: "All levels" },
  { value: "critical", label: "Critical" },
  { value: "low", label: "Low stock" },
  { value: "overstock", label: "Overstock" },
  { value: "ok", label: "Healthy" },
];

export default function InventoryPage() {
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [alertFilter, setAlertFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "available",
    dir: "asc",
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const warehouses = useApi<Warehouse[]>("/api/warehouses");
  const inventory = useApi<InventoryRow[]>(
    `/api/inventory${warehouseId ? `?warehouse_id=${warehouseId}` : ""}`,
  );
  const products = useApi<Product[]>("/api/products");
  const transfers = useApi<Transfer[]>("/api/inventory/transfers");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const term = params.get("search") ?? params.get("sku");
    if (term) setSearch(term);
    const alert = params.get("alert");
    if (alert && ALERT_FILTERS.some((entry) => entry.value === alert)) setAlertFilter(alert);
    const warehouse = params.get("warehouse");
    if (warehouse && !Number.isNaN(Number(warehouse))) setWarehouseId(Number(warehouse));
  }, []);

  const costByProduct = useMemo(() => {
    const map = new Map<number, number>();
    (products.data ?? []).forEach((product) => map.set(product.id, product.unit_cost));
    return map;
  }, [products.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = inventory.data ?? [];
    if (alertFilter !== "all") {
      rows =
        alertFilter === "critical"
          ? rows.filter((row) => ["critical", "stockout"].includes(row.alert_level))
          : rows.filter((row) => row.alert_level === alertFilter);
    }
    if (term) {
      rows = rows.filter(
        (row) =>
          row.sku.toLowerCase().includes(term) ||
          row.product_name.toLowerCase().includes(term) ||
          row.warehouse_name.toLowerCase().includes(term),
      );
    }
    return [...rows].sort((a, b) => {
      const factor = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "sku") return a.sku.localeCompare(b.sku) * factor;
      if (sort.key === "cover")
        return ((a.days_of_cover ?? 9999) - (b.days_of_cover ?? 9999)) * factor;
      if (sort.key === "order")
        return (a.recommended_order_quantity - b.recommended_order_quantity) * factor;
      return (a.available_stock - b.available_stock) * factor;
    });
  }, [inventory.data, alertFilter, search, sort]);

  const totals = useMemo(() => {
    const rows = inventory.data ?? [];
    const valuation = rows.reduce(
      (sum, row) => sum + row.available_stock * (costByProduct.get(row.product_id) ?? 0),
      0,
    );
    return {
      valuation,
      units: rows.reduce((sum, row) => sum + row.available_stock, 0),
      orderUnits: rows.reduce((sum, row) => sum + row.recommended_order_quantity, 0),
      risk: rows.filter((row) => row.stockout_risk).length,
      alerts: rows.filter((row) => row.alert_level !== "ok").length,
    };
  }, [inventory.data, costByProduct]);

  async function recalculate() {
    setBusy(true);
    try {
      const response = await apiPost<{ summary: Record<string, number> }>(
        "/api/inventory/optimize",
        { service_level: 0.95, review_period_days: 7 },
      );
      inventory.reload?.();
      setToast({
        message: `Recomputed ${num(response.summary.items_evaluated)} positions · ${num(
          response.summary.replenishment_required,
        )} need replenishment (${num(response.summary.total_recommended_units)} units).`,
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

  const activeFilters = (search ? 1 : 0) + (alertFilter !== "all" ? 1 : 0) + (warehouseId ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Inventory Management"
        subtitle="Multi-warehouse stock with computed safety stock, reorder points and recommended order quantities. Demand is read from persisted forecasts and distributed by historical warehouse share."
        actions={
          <button className="btn-primary" onClick={recalculate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            {busy ? "Optimizing…" : "Run optimization"}
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Inventory valuation"
          value={money(totals.valuation)}
          hint={`${num(totals.units)} available units at cost`}
          tone="brand"
        />
        <KpiCard
          label="Active alerts"
          value={num(totals.alerts)}
          hint="Critical, low and overstock positions"
          tone="warning"
        />
        <KpiCard
          label="Stockout risk"
          value={num(totals.risk)}
          hint="Cover below the safety window"
          tone={totals.risk ? "danger" : "success"}
        />
        <KpiCard
          label="Recommended order units"
          value={num(totals.orderUnits)}
          hint="Target − available − incoming, MOQ applied"
        />
      </div>

      <Card
        className="mt-6"
        title="Stock position"
        description="Available = current − reserved · ROP = daily demand × lead time + safety stock"
        actions={
          <span className="text-[11px] text-stone">
            {filtered.length} of {inventory.data?.length ?? 0} positions
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search SKU, product or warehouse…"
              className="field pl-9 pr-9"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone hover:text-forest-800"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <select
            className="field !w-auto"
            value={warehouseId}
            onChange={(event) =>
              setWarehouseId(event.target.value ? Number(event.target.value) : "")
            }
            aria-label="Filter by warehouse"
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
            aria-label="Filter by alert level"
          >
            {ALERT_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          {activeFilters ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setSearch("");
                setAlertFilter("all");
                setWarehouseId("");
              }}
            >
              Reset filters
            </button>
          ) : null}
        </div>

        {inventory.loading && !inventory.data ? <LoadingPanel rows={6} /> : null}
        {inventory.error ? <ErrorPanel message={inventory.error} onRetry={inventory.reload} /> : null}
        {inventory.data && filtered.length === 0 ? (
          <EmptyPanel
            message="No stock positions match the current filters."
            action={
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => {
                  setSearch("");
                  setAlertFilter("all");
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : null}

        {filtered.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <SortHeader
                    label="Product"
                    active={sort.key === "sku"}
                    direction={sort.dir}
                    onClick={() =>
                      setSort((current) => ({
                        key: "sku",
                        dir: current.key === "sku" && current.dir === "asc" ? "desc" : "asc",
                      }))
                    }
                  />
                  <th>Warehouse</th>
                  <SortHeader
                    label="Available"
                    active={sort.key === "available"}
                    direction={sort.dir}
                    align="right"
                    onClick={() =>
                      setSort((current) => ({
                        key: "available",
                        dir: current.key === "available" && current.dir === "asc" ? "desc" : "asc",
                      }))
                    }
                  />
                  <th className="min-w-[132px]">Stock level</th>
                  <th className="text-right">Safety</th>
                  <th className="text-right">ROP</th>
                  <SortHeader
                    label="Cover"
                    active={sort.key === "cover"}
                    direction={sort.dir}
                    align="right"
                    onClick={() =>
                      setSort((current) => ({
                        key: "cover",
                        dir: current.key === "cover" && current.dir === "asc" ? "desc" : "asc",
                      }))
                    }
                  />
                  <SortHeader
                    label="Order qty"
                    active={sort.key === "order"}
                    direction={sort.dir}
                    align="right"
                    onClick={() =>
                      setSort((current) => ({
                        key: "order",
                        dir: current.key === "order" && current.dir === "asc" ? "desc" : "asc",
                      }))
                    }
                  />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const level = row.available_stock / (row.target_stock || 1);
                  const tone =
                    row.alert_level === "critical" || row.alert_level === "stockout"
                      ? "danger"
                      : row.alert_level === "low"
                        ? "warn"
                        : row.alert_level === "overstock"
                          ? "sage"
                          : "forest";
                  return (
                    <tr key={`${row.product_id}-${row.warehouse_id}`}>
                      <td>
                        <p className="font-medium text-ink">{row.sku}</p>
                        <p className="text-[11px] text-stone">{row.product_name}</p>
                      </td>
                      <td className="whitespace-nowrap text-[12px] text-stone">
                        {row.warehouse_code}
                      </td>
                      <td className="text-right font-medium tabular-nums">
                        {num(row.available_stock)}
                        {row.stockout_risk ? (
                          <ShieldAlert className="ml-1 inline h-3.5 w-3.5 text-danger" />
                        ) : null}
                      </td>
                      <td>
                        <Progress value={level * 100} tone={tone} />
                        <p className="mt-1 text-[10px] text-stone">
                          {Math.round(level * 100)}% of target
                        </p>
                      </td>
                      <td className="text-right tabular-nums text-stone">{num(row.safety_stock)}</td>
                      <td className="text-right tabular-nums text-stone">{num(row.reorder_point)}</td>
                      <td className="text-right tabular-nums">
                        {row.days_of_cover === null ? "—" : `${num(row.days_of_cover, 1)} d`}
                      </td>
                      <td className="text-right font-semibold tabular-nums text-forest-900">
                        {row.recommended_order_quantity > 0
                          ? num(row.recommended_order_quantity)
                          : "—"}
                      </td>
                      <td>
                        <Badge value={ALERT_LABELS[row.alert_level] ?? row.alert_level} kind="alert" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Transfer recommendations"
          description="Sources never drop below their own safety stock"
          actions={<ArrowLeftRight className="h-4 w-4 text-stone" />}
        >
          {transfers.loading && !transfers.data ? <LoadingPanel rows={3} /> : null}
          {transfers.error ? <ErrorPanel message={transfers.error} /> : null}
          {transfers.data && transfers.data.length === 0 ? (
            <EmptyPanel message="No inter-warehouse transfer recommended yet. Run the demonstration scenario to generate one from live stock." />
          ) : null}
          {transfers.data?.length ? (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Route</th>
                    <th className="text-right">Quantity</th>
                    <th>Feasibility</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.data.slice(0, 8).map((transfer) => (
                    <tr key={transfer.id}>
                      <td className="font-medium">{transfer.sku}</td>
                      <td className="text-[12px] text-stone">
                        {transfer.from_warehouse_name} → {transfer.to_warehouse_name}
                      </td>
                      <td className="text-right tabular-nums">{num(transfer.quantity)}</td>
                      <td>
                        <Badge value={transfer.feasible ? "feasible" : "partial"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
        </Card>

        <Card title="How quantities are derived" description="Documented engine assumptions">
          <ul className="space-y-2.5 text-[13px] leading-relaxed text-stone">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest-400" />
              Safety stock = Z(service level) × σ(daily demand) × √lead time.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest-400" />
              Lead time is taken from the fastest active supplier for the product.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest-400" />
              Target stock covers lead time plus the 7-day review period.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest-400" />
              Recommended order = max(target − available − incoming, 0), rounded up to the MOQ.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-forest-400" />
              Units are base units; lead times and review periods are calendar days.
            </li>
          </ul>
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-[#FBFAF6] px-3 py-2 text-[11px] text-stone">
            <PackageSearch className="h-3.5 w-3.5" />
            Valuation uses product unit cost, not selling price.
          </p>
        </Card>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
