"use client";

import { useEffect, useMemo, useState } from "react";
import { PackagePlus, Scale } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Toast,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { money, num } from "@/lib/format";
import type {
  Product,
  PurchaseOrder,
  Supplier,
  SupplierRecommendation,
} from "@/types";

type GenerateResponse = {
  orders: PurchaseOrder[];
  rankings: Array<Record<string, unknown>>;
  skipped: Array<{ sku: string; reason: string }>;
  summary: { order_count: number; total_cost: number; supplier_count: number };
};

export default function ProcurementPage() {
  const [productId, setProductId] = useState<number | "">("");
  const [quantity, setQuantity] = useState(400);
  const [weights, setWeights] = useState({ cost: 0.4, lead_time: 0.3, reliability: 0.3 });
  const [recommendation, setRecommendation] = useState<SupplierRecommendation | null>(null);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const products = useApi<Product[]>("/api/products");
  const suppliers = useApi<Supplier[]>("/api/suppliers");
  const orders = useApi<PurchaseOrder[]>("/api/procurement/orders");

  useEffect(() => {
    if (!productId && products.data?.length) setProductId(products.data[0].id);
  }, [products.data, productId]);

  const offers = useMemo(() => {
    if (!suppliers.data) return [];
    return suppliers.data.flatMap((supplier) =>
      supplier.offers
        .filter((offer) => !productId || offer.product_id === productId)
        .map((offer) => ({ ...offer, supplier: supplier.name, status: supplier.status })),
    );
  }, [suppliers.data, productId]);

  async function recommend() {
    if (!productId) return;
    setBusy("recommend");
    try {
      const response = await apiPost<SupplierRecommendation>("/api/suppliers/recommend", {
        product_id: productId,
        quantity,
        weights,
      });
      setRecommendation(response);
      setToast({ message: response.recommendation, tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Recommendation failed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    try {
      const response = await apiPost<GenerateResponse>("/api/procurement/generate", {
        weights,
        persist: true,
      });
      setGenerated(response);
      orders.reload?.();
      setToast({
        message: `${response.summary.order_count} purchase order(s) recommended worth ${money(
          response.summary.total_cost,
        )}.`,
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Generation failed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Procurement and suppliers"
        subtitle="Weighted supplier scoring over normalised cost, lead time and reliability. Orders shown here are simulated planning records — nothing is transmitted to a supplier."
        actions={
          <button className="btn-primary" onClick={generate} disabled={busy !== null}>
            <PackagePlus className="h-4 w-4" />
            {busy === "generate" ? "Generating…" : "Generate purchase orders"}
          </button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Ranking weights" description="Normalised server-side before scoring">
          {(["cost", "lead_time", "reliability"] as const).map((key) => (
            <label key={key} className="mb-4 block">
              <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide muted">
                {key.replace("_", " ")}
                <span className="tabular-nums">{weights[key].toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weights[key]}
                onChange={(event) =>
                  setWeights({ ...weights, [key]: Number(event.target.value) })
                }
                className="mt-2 w-full accent-brand-600"
              />
            </label>
          ))}
          <div className="mt-2 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide muted">
              Product
              <select
                className="field mt-1 font-normal normal-case"
                value={productId}
                onChange={(event) => setProductId(Number(event.target.value))}
              >
                {(products.data ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} · {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide muted">
              Quantity
              <input
                type="number"
                min={1}
                className="field mt-1 font-normal"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </label>
            <button className="btn-secondary w-full" onClick={recommend} disabled={busy !== null}>
              <Scale className="h-4 w-4" />
              {busy === "recommend" ? "Ranking…" : "Rank suppliers"}
            </button>
          </div>
        </Card>

        <Card
          title="Supplier ranking"
          description={recommendation ? recommendation.product_name : "Run a ranking to see scores"}
          className="xl:col-span-2"
        >
          {!recommendation ? (
            <EmptyState message="Choose a product and quantity, then rank the suppliers." />
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Supplier</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Lead time</th>
                    <th className="text-right">Reliability</th>
                    <th>Eligible</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendation.ranked_suppliers.map((supplier) => (
                    <tr key={supplier.supplier_id}>
                      <td className="tabular-nums">{supplier.rank}</td>
                      <td className="font-medium">{supplier.supplier_name}</td>
                      <td className="text-right font-semibold tabular-nums">
                        {supplier.score.toFixed(1)}
                      </td>
                      <td className="text-right tabular-nums">${supplier.unit_price.toFixed(2)}</td>
                      <td className="text-right tabular-nums">{supplier.lead_time_days}d</td>
                      <td className="text-right tabular-nums">
                        {supplier.reliability_score.toFixed(2)}
                      </td>
                      <td>
                        <Badge value={supplier.eligible ? "eligible" : "blocked"} kind="plain" />
                        {!supplier.eligible && (supplier as unknown as { disqualification_reason?: string }).disqualification_reason ? (
                          <p className="mt-1 text-xs muted">
                            {(supplier as unknown as { disqualification_reason: string }).disqualification_reason}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 pt-3 text-xs muted">{recommendation.recommendation}</p>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Purchase-order recommendations"
          description={
            generated
              ? `${generated.summary.order_count} orders · ${money(generated.summary.total_cost)}`
              : "Generated from current replenishment requirements"
          }
        >
          {generated?.orders?.length ? (
            <div className="-mx-5 max-h-80 overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Supplier</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Cost</th>
                    <th>ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {generated.orders.map((order) => (
                    <tr key={`${order.product_id}-${order.supplier_name}-${order.quantity}`}>
                      <td className="font-medium">{order.sku}</td>
                      <td className="text-xs">{order.supplier_name}</td>
                      <td className="text-right tabular-nums">{num(order.quantity)}</td>
                      <td className="text-right tabular-nums">{money(order.total_cost)}</td>
                      <td className="text-xs">{order.expected_delivery_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="Run “Generate purchase orders” to create recommendations from live inventory needs." />
          )}
          {generated?.skipped?.length ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {generated.skipped.length} requirement(s) skipped:{" "}
              {generated.skipped.map((item) => `${item.sku} (${item.reason})`).join("; ")}
            </div>
          ) : null}
        </Card>

        <Card title="Orders on record" description="Persisted purchase_orders rows">
          {orders.loading && !orders.data ? <LoadingState /> : null}
          {orders.error ? <ErrorState message={orders.error} /> : null}
          {orders.data && orders.data.length === 0 ? (
            <EmptyState message="No purchase orders stored yet." />
          ) : null}
          {orders.data?.length ? (
            <div className="-mx-5 max-h-80 overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>SKU</th>
                    <th>Supplier</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.map((order) => (
                    <tr key={order.id ?? `${order.sku}-${order.expected_delivery_date}`}>
                      <td className="tabular-nums text-xs">{order.id ?? "—"}</td>
                      <td className="font-medium">{order.sku}</td>
                      <td className="text-xs">{order.supplier_name}</td>
                      <td className="text-right tabular-nums">{num(order.quantity)}</td>
                      <td className="text-right tabular-nums">{money(order.total_cost)}</td>
                      <td>
                        <Badge value={order.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      <Card
        title="Supplier comparison"
        description="Commercial terms on file for the selected product"
        className="mt-6"
      >
        <div className="-mx-5 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Status</th>
                <th className="text-right">Unit price</th>
                <th className="text-right">Lead time</th>
                <th className="text-right">Reliability</th>
                <th className="text-right">MOQ</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={`${offer.supplier}-${offer.product_id}`}>
                  <td className="font-medium">{offer.supplier}</td>
                  <td>
                    <Badge value={offer.status} />
                  </td>
                  <td className="text-right tabular-nums">${offer.unit_price.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{offer.lead_time_days}d</td>
                  <td className="text-right tabular-nums">{offer.reliability_score.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{num(offer.minimum_order_quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
