"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  ChevronRight,
  Loader2,
  PackagePlus,
  Scale,
  SlidersHorizontal,
  Star,
  Truck,
} from "lucide-react";
import {
  Badge,
  Card,
  Drawer,
  EmptyPanel,
  ErrorPanel,
  Field,
  KpiCard,
  LoadingPanel,
  PageHeader,
  Progress,
  SortHeader,
  StatRow,
  TableWrap,
  Toast,
} from "@/components/ui";
import { ApiError, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { formatDate, money, num } from "@/lib/format";
import type {
  Product,
  PurchaseOrder,
  RankedSupplier,
  Supplier,
  SupplierRecommendation,
} from "@/types";

type GenerateResponse = {
  orders: PurchaseOrder[];
  rankings: Array<Record<string, unknown>>;
  skipped: Array<{ sku: string; reason: string }>;
  summary: { order_count: number; total_cost: number; supplier_count: number };
};

type OfferRow = {
  supplier: Supplier;
  product_id: number;
  sku: string;
  product_name: string;
  unit_price: number;
  lead_time_days: number;
  reliability_score: number;
  minimum_order_quantity: number;
};

type SortKey = "price" | "lead" | "reliability";

export default function ProcurementPage() {
  const [productId, setProductId] = useState<number | "">("");
  const [quantity, setQuantity] = useState(400);
  const [weights, setWeights] = useState({ cost: 0.4, lead_time: 0.3, reliability: 0.3 });
  const [recommendation, setRecommendation] = useState<SupplierRecommendation | null>(null);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "price",
    dir: "asc",
  });
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const products = useApi<Product[]>("/api/products");
  const suppliers = useApi<Supplier[]>("/api/suppliers");
  const orders = useApi<PurchaseOrder[]>("/api/procurement/orders");

  useEffect(() => {
    if (!productId && products.data?.length) setProductId(products.data[0].id);
  }, [products.data, productId]);

  const offers = useMemo<OfferRow[]>(() => {
    const rows: OfferRow[] = [];
    (suppliers.data ?? []).forEach((supplier) => {
      supplier.offers
        .filter((offer) => !productId || offer.product_id === productId)
        .forEach((offer) =>
          rows.push({
            supplier,
            product_id: offer.product_id,
            sku: offer.sku,
            product_name: offer.product_name,
            unit_price: offer.unit_price,
            lead_time_days: offer.lead_time_days,
            reliability_score: offer.reliability_score,
            minimum_order_quantity: offer.minimum_order_quantity,
          }),
        );
    });
    return rows.sort((a, b) => {
      const factor = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "lead") return (a.lead_time_days - b.lead_time_days) * factor;
      if (sort.key === "reliability")
        return (a.reliability_score - b.reliability_score) * factor;
      return (a.unit_price - b.unit_price) * factor;
    });
  }, [suppliers.data, productId, sort]);

  const selectedProduct = products.data?.find((product) => product.id === productId) ?? null;

  const activeSuppliers = (suppliers.data ?? []).filter(
    (supplier) => supplier.status === "active",
  ).length;

  const recommendedId = recommendation?.recommended_supplier_id ?? null;
  const bestOfferPrice = offers.length ? Math.min(...offers.map((offer) => offer.unit_price)) : 0;
  const fastestLead = offers.length ? Math.min(...offers.map((offer) => offer.lead_time_days)) : 0;

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
        )} across ${response.summary.supplier_count} supplier(s).`,
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

  const rankedForSupplier = (supplierId: number): RankedSupplier | undefined =>
    recommendation?.ranked_suppliers.find((row) => row.supplier_id === supplierId);

  const drawerOffers = (selectedSupplier?.offers ?? []).slice(0, 8);

  return (
    <>
      <PageHeader
        title="Procurement"
        subtitle="Weighted supplier scoring across normalised cost, lead time and reliability. Recommendations are simulated planning records — nothing is transmitted to a supplier."
        actions={
          <button className="btn-primary" onClick={generate} disabled={busy !== null}>
            {busy === "generate" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PackagePlus className="h-4 w-4" />
            )}
            {busy === "generate" ? "Generating…" : "Generate purchase orders"}
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active suppliers"
          value={num(activeSuppliers)}
          hint={`${num(suppliers.data?.length ?? 0)} on file`}
          icon={<Truck className="h-4 w-4" />}
        />
        <KpiCard
          label="Best unit price"
          value={offers.length ? money(bestOfferPrice, { digits: 2 }) : "—"}
          hint={selectedProduct ? `${selectedProduct.sku} · before MOQ` : "Select a product"}
          tone="brand"
        />
        <KpiCard
          label="Fastest lead time"
          value={offers.length ? `${num(fastestLead)} d` : "—"}
          hint="Calendar days from order to receipt"
        />
        <KpiCard
          label="Pending procurement"
          value={num(orders.data?.length ?? 0)}
          hint={money(
            (orders.data ?? [])
              .filter((order) => ["recommended", "pending"].includes(order.status))
              .reduce((sum, order) => sum + order.total_cost, 0),
          )}
          tone="warning"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Ranking weights" description="Normalised server-side before scoring">
          <div className="space-y-5">
            {(["cost", "lead_time", "reliability"] as const).map((key) => (
              <label key={key} className="block">
                <span className="flex items-center justify-between">
                  <span className="label capitalize">{key.replace("_", " ")}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-forest-900">
                    {weights[key].toFixed(2)}
                  </span>
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
                  className="mt-2 w-full accent-forest-700"
                  aria-label={`${key} weight`}
                />
              </label>
            ))}

            <div className="space-y-3 border-t border-line pt-4">
              <Field label="Product">
                <select
                  className="field"
                  value={productId}
                  onChange={(event) => {
                    setProductId(Number(event.target.value));
                    setRecommendation(null);
                  }}
                >
                  {(products.data ?? []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Order quantity" hint="Units">
                <input
                  type="number"
                  min={1}
                  className="field"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </Field>
              <button className="btn-outline w-full" onClick={recommend} disabled={busy !== null}>
                {busy === "recommend" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scale className="h-4 w-4" />
                )}
                {busy === "recommend" ? "Ranking…" : "Rank suppliers"}
              </button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {recommendation ? (
            <Card
              title="Supplier ranking"
              description={`${recommendation.product_name} · ${num(
                recommendation.quantity,
              )} units · weights cost ${recommendation.weights.cost ?? weights.cost}, lead ${
                recommendation.weights.lead_time ?? weights.lead_time
              }, reliability ${recommendation.weights.reliability ?? weights.reliability}`}
              bodyClassName="pb-2"
            >
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Supplier</th>
                      <th className="text-right">Score</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Lead time</th>
                      <th className="text-right">Reliability</th>
                      <th className="text-right">Est. cost</th>
                      <th>Eligibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendation.ranked_suppliers.map((supplier) => (
                      <tr
                        key={supplier.supplier_id}
                        className={
                          supplier.supplier_id === recommendedId ? "bg-forest-50/70" : undefined
                        }
                      >
                        <td className="tabular-nums text-stone">{supplier.rank ?? "—"}</td>
                        <td>
                          <p className="font-medium text-ink">{supplier.supplier_name}</p>
                          {supplier.supplier_id === recommendedId ? (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#2F6B4A]">
                              <Award className="h-3 w-3" /> Recommended
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right font-semibold tabular-nums">
                          {supplier.score.toFixed(1)}
                        </td>
                        <td className="text-right tabular-nums">
                          {money(supplier.unit_price, { digits: 2 })}
                        </td>
                        <td className="text-right tabular-nums">{supplier.lead_time_days} d</td>
                        <td className="text-right tabular-nums">
                          {supplier.reliability_score.toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums">
                          {money(
                            supplier.total_cost ??
                              supplier.unit_price * recommendation.quantity,
                          )}
                        </td>
                        <td>
                          <Badge value={supplier.eligible ? "eligible" : "blocked"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="px-5 py-3 text-[11px] leading-relaxed text-stone">
                {recommendation.recommendation}
              </p>
            </Card>
          ) : null}

          <Card
            title="Supplier comparison"
            description={
              selectedProduct
                ? `${selectedProduct.sku} · ${selectedProduct.name} · commercial terms on file`
                : "Commercial terms on file"
            }
            actions={
              <span className="flex items-center gap-1 text-[11px] text-stone">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Click a row for detail
              </span>
            }
            bodyClassName="pb-2"
          >
            {suppliers.loading && !suppliers.data ? <LoadingPanel rows={5} /> : null}
            {suppliers.error ? <ErrorPanel message={suppliers.error} onRetry={suppliers.reload} /> : null}
            {offers.length === 0 && suppliers.data ? (
              <EmptyPanel message="No supplier offers recorded for this product." />
            ) : null}
            {offers.length ? (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Status</th>
                      <SortHeader
                        label="Unit price"
                        align="right"
                        active={sort.key === "price"}
                        direction={sort.dir}
                        onClick={() =>
                          setSort((current) => ({
                            key: "price",
                            dir: current.key === "price" && current.dir === "asc" ? "desc" : "asc",
                          }))
                        }
                      />
                      <SortHeader
                        label="Lead time"
                        align="right"
                        active={sort.key === "lead"}
                        direction={sort.dir}
                        onClick={() =>
                          setSort((current) => ({
                            key: "lead",
                            dir: current.key === "lead" && current.dir === "asc" ? "desc" : "asc",
                          }))
                        }
                      />
                      <SortHeader
                        label="Reliability"
                        align="right"
                        active={sort.key === "reliability"}
                        direction={sort.dir}
                        onClick={() =>
                          setSort((current) => ({
                            key: "reliability",
                            dir:
                              current.key === "reliability" && current.dir === "asc" ? "desc" : "asc",
                          }))
                        }
                      />
                      <th className="text-right">MOQ</th>
                      <th className="text-right">Est. cost ({num(quantity)} u)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((offer) => (
                      <tr
                        key={`${offer.supplier.id}-${offer.product_id}`}
                        className="cursor-pointer"
                        onClick={() => setSelectedSupplier(offer.supplier)}
                      >
                        <td>
                          <p className="font-medium text-ink">{offer.supplier.name}</p>
                          <p className="text-[11px] text-stone">{offer.supplier.code}</p>
                        </td>
                        <td>
                          <Badge value={offer.supplier.status} />
                        </td>
                        <td className="text-right tabular-nums">
                          {money(offer.unit_price, { digits: 2 })}
                        </td>
                        <td className="text-right tabular-nums">{offer.lead_time_days} d</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress
                              value={offer.reliability_score * 100}
                              tone={offer.reliability_score >= 0.9 ? "forest" : offer.reliability_score >= 0.75 ? "sage" : "warn"}
                              className="!w-14"
                            />
                            <span className="w-8 tabular-nums">{offer.reliability_score.toFixed(2)}</span>
                          </div>
                        </td>
                        <td className="text-right tabular-nums">{num(offer.minimum_order_quantity)}</td>
                        <td className="text-right font-medium tabular-nums text-forest-900">
                          {money(offer.unit_price * quantity)}
                        </td>
                        <td className="text-right">
                          <ChevronRight className="ml-auto h-4 w-4 text-stone" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : null}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title="Purchase-order recommendations"
              description={
                generated
                  ? `${generated.summary.order_count} orders · ${money(generated.summary.total_cost)}`
                  : "Generated from current replenishment requirements"
              }
              bodyClassName="pb-2"
            >
              {generated?.orders?.length ? (
                <TableWrap>
                  <table className="table">
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
                          <td className="text-[12px] text-stone">{order.supplier_name}</td>
                          <td className="text-right tabular-nums">{num(order.quantity)}</td>
                          <td className="text-right tabular-nums">{money(order.total_cost)}</td>
                          <td className="text-[12px] text-stone">
                            {formatDate(order.expected_delivery_date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <EmptyPanel message="Run “Generate purchase orders” to create recommendations from live inventory needs." />
              )}
              {generated?.skipped?.length ? (
                <p className="mx-5 mt-3 rounded-lg bg-[#FBF3E4] px-3 py-2 text-[11px] leading-relaxed text-[#94651F]">
                  {generated.skipped.length} requirement(s) skipped:{" "}
                  {generated.skipped.map((item) => `${item.sku} (${item.reason})`).join("; ")}
                </p>
              ) : null}
            </Card>

            <Card title="Purchase orders on record" description="Persisted planning rows" bodyClassName="pb-2">
              {orders.loading && !orders.data ? <LoadingPanel rows={4} /> : null}
              {orders.error ? <ErrorPanel message={orders.error} /> : null}
              {orders.data && orders.data.length === 0 ? (
                <EmptyPanel message="No purchase orders stored yet." />
              ) : null}
              {orders.data?.length ? (
                <TableWrap>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>SKU</th>
                        <th>Supplier</th>
                        <th className="text-right">Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.data.map((order) => (
                        <tr key={order.id ?? `${order.sku}-${order.expected_delivery_date}`}>
                          <td className="tabular-nums text-[12px] text-stone">
                            {order.id ? `PO-${order.id}` : "—"}
                          </td>
                          <td className="font-medium">{order.sku}</td>
                          <td className="max-w-[150px] truncate text-[12px] text-stone">
                            {order.supplier_name}
                          </td>
                          <td className="text-right tabular-nums">{money(order.total_cost)}</td>
                          <td>
                            <Badge value={order.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : null}
            </Card>
          </div>
        </div>
      </div>

      <Drawer
        open={Boolean(selectedSupplier)}
        onClose={() => setSelectedSupplier(null)}
        title={selectedSupplier?.name ?? "Supplier"}
        subtitle={`${selectedSupplier?.code ?? ""} · ${selectedSupplier?.contact_email ?? ""}`}
        footer={
          <div className="flex items-center justify-between text-[11px] text-stone">
            <span className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5" />
              Reliability is the historical on-time delivery score.
            </span>
            <button className="btn-outline btn-sm" onClick={() => setSelectedSupplier(null)}>
              Close
            </button>
          </div>
        }
      >
        {selectedSupplier ? (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Badge value={selectedSupplier.status} />
              <Badge
                value={`${selectedSupplier.offers.length} offers on file`}
                kind="outline"
              />
              {rankedForSupplier(selectedSupplier.id) ? (
                <Badge value={`score ${rankedForSupplier(selectedSupplier.id)!.score.toFixed(1)}`} kind="outline" />
              ) : null}
            </div>

            <dl>
              <StatRow label="Contact" value={selectedSupplier.contact_email || "—"} />
              <StatRow
                label="Products supplied"
                value={num(new Set(selectedSupplier.offers.map((offer) => offer.product_id)).size)}
              />
              <StatRow
                label="Average lead time"
                value={`${num(
                  selectedSupplier.offers.reduce((sum, offer) => sum + offer.lead_time_days, 0) /
                    Math.max(selectedSupplier.offers.length, 1),
                  1,
                )} d`}
              />
              <StatRow
                label="Average reliability"
                value={(
                  selectedSupplier.offers.reduce(
                    (sum, offer) => sum + offer.reliability_score,
                    0,
                  ) / Math.max(selectedSupplier.offers.length, 1)
                ).toFixed(2)}
              />
              {recommendation?.product_id === productId ? (
                <StatRow
                  label={`Est. cost · ${num(quantity)} units`}
                  value={money(
                    (rankedForSupplier(selectedSupplier.id)?.unit_price ??
                      offers.find((offer) => offer.supplier.id === selectedSupplier.id)?.unit_price ??
                      0) * quantity,
                  )}
                  tone="success"
                />
              ) : null}
            </dl>

            <div>
              <p className="label mb-2">Catalogue</p>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Lead</th>
                      <th className="text-right">MOQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawerOffers.map((offer) => (
                      <tr key={`${offer.product_id}-${offer.sku}`}>
                        <td>
                          <p className="text-[12px] font-medium">{offer.sku}</p>
                          <p className="truncate text-[11px] text-stone">{offer.product_name}</p>
                        </td>
                        <td className="text-right tabular-nums">
                          {money(offer.unit_price, { digits: 2 })}
                        </td>
                        <td className="text-right tabular-nums">{offer.lead_time_days} d</td>
                        <td className="text-right tabular-nums">
                          {num(offer.minimum_order_quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {rankedForSupplier(selectedSupplier.id)?.explanation ? (
              <div className="rounded-xl bg-[#FBFAF6] px-4 py-3">
                <p className="label mb-1">Scoring rationale</p>
                <p className="text-[12px] leading-relaxed text-stone">
                  {rankedForSupplier(selectedSupplier.id)!.explanation}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
