"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Truck,
  Zap,
} from "lucide-react";
import {
  Badge,
  Card,
  EmptyPanel,
  ErrorPanel,
  Field,
  KpiCard,
  LoadingPanel,
  PageHeader,
  StatRow,
  TableWrap,
  Toast,
} from "@/components/ui";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { formatDate, num } from "@/lib/format";
import type { Disruption, DisruptionAssessment, Product, Supplier } from "@/types";

const TYPES = [
  { value: "delivery_delay", label: "Delivery delay" },
  { value: "supplier_unavailable", label: "Supplier unavailable" },
  { value: "lead_time_increase", label: "Lead-time increase" },
  { value: "reliability_reduction", label: "Reliability reduction" },
];

export default function DisruptionsPage() {
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [productId, setProductId] = useState<number | "">("");
  const [type, setType] = useState(TYPES[0].value);
  const [delayDays, setDelayDays] = useState(10);
  const [reliabilityDelta, setReliabilityDelta] = useState(-0.15);
  const [assessment, setAssessment] = useState<DisruptionAssessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const suppliers = useApi<Supplier[]>("/api/suppliers");
  const products = useApi<Product[]>("/api/products");
  const active = useApi<Disruption[]>("/api/disruptions/active");

  async function simulate() {
    if (!supplierId) {
      setToast({ message: "Select a supplier to disrupt first.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const response = await apiPost<DisruptionAssessment>("/api/disruptions/simulate", {
        supplier_id: supplierId,
        product_id: productId || null,
        disruption_type: type,
        delay_days: delayDays,
        reliability_delta: reliabilityDelta,
      });
      setAssessment(response);
      active.reload?.();
      setToast({
        message: `Disruption recorded · highest stockout risk ${response.overall_stockout_risk}.`,
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Simulation failed.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: number) {
    try {
      await apiPost(`/api/disruptions/${id}/resolve`);
      active.reload?.();
      setToast({ message: `Disruption DR-${id} resolved.`, tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Could not resolve.",
        tone: "error",
      });
    }
  }

  async function loadAssessment(id: number) {
    try {
      const response = await apiGet<DisruptionAssessment>(`/api/disruptions/${id}/assessment`);
      setAssessment(response);
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Assessment unavailable.",
        tone: "error",
      });
    }
  }

  const activeCount = active.data?.length ?? 0;
  const criticalCount = (active.data ?? []).filter((row) => row.severity === "critical").length;

  return (
    <>
      <PageHeader
        title="Disruption Management"
        subtitle="Simulate supplier delays, unavailability or collapsing reliability. Each event is assessed against live stock and forecast demand, then routed to alternative suppliers or internal transfers."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active disruptions"
          value={num(activeCount)}
          hint="Within their active date window"
          icon={<Truck className="h-4 w-4" />}
          tone={activeCount ? "danger" : "success"}
        />
        <KpiCard
          label="Critical severity"
          value={num(criticalCount)}
          hint="Requires immediate recovery"
          tone={criticalCount ? "danger" : "neutral"}
        />
        <KpiCard
          label="Suppliers on file"
          value={num(suppliers.data?.length ?? 0)}
          hint={`${num(
            (suppliers.data ?? []).filter((supplier) => supplier.status === "active").length,
          )} active`}
        />
        <KpiCard
          label="Assessed risk"
          value={assessment ? assessment.overall_stockout_risk : "—"}
          hint={assessment ? assessment.disruption.supplier_name : "Run a simulation"}
          tone={
            assessment?.overall_stockout_risk === "critical"
              ? "danger"
              : assessment
                ? "warning"
                : "neutral"
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card title="Simulate a disruption" description="Recorded as a simulated planning event">
          <div className="space-y-4">
            <Field label="Supplier">
              <select
                className="field"
                value={supplierId}
                onChange={(event) => setSupplierId(Number(event.target.value))}
              >
                <option value="">Select supplier…</option>
                {(suppliers.data ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id} disabled={supplier.status !== "active"}>
                    {supplier.name} · {supplier.status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Affected product" hint="Leave empty to apply to the whole supplier">
              <select
                className="field"
                value={productId}
                onChange={(event) =>
                  setProductId(event.target.value ? Number(event.target.value) : "")
                }
              >
                <option value="">All supplier products</option>
                {(products.data ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} · {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Disruption type">
              <select className="field" value={type} onChange={(event) => setType(event.target.value)}>
                {TYPES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Delay (days)">
                <input
                  type="number"
                  min={0}
                  max={90}
                  className="field"
                  value={delayDays}
                  onChange={(event) => setDelayDays(Number(event.target.value))}
                />
              </Field>
              <Field label="Reliability delta">
                <input
                  type="number"
                  min={-1}
                  max={0}
                  step={0.05}
                  className="field"
                  value={reliabilityDelta}
                  onChange={(event) => setReliabilityDelta(Number(event.target.value))}
                />
              </Field>
            </div>
            <button className="btn-primary w-full" onClick={simulate} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {busy ? "Assessing impact…" : "Simulate Disruption"}
            </button>
            <p className="flex items-start gap-2 rounded-lg bg-[#FBFAF6] px-3 py-2 text-[11px] leading-relaxed text-stone">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Simulated events never contact a supplier and expire after their window. Assess any
              active event to reload its recovery plan.
            </p>
          </div>
        </Card>

        <Card
          title="Recovery workflow"
          description="Detect → assess exposure → find alternatives → plan recovery"
        >
          {!assessment ? (
            <EmptyPanel message="Simulate a disruption, or open an active event, to generate a recovery plan from live stock." />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge value={assessment.disruption.severity} kind="alert" />
                <Badge value={`stockout risk: ${assessment.overall_stockout_risk}`} kind="alert" />
                <span className="text-[12px] text-stone">
                  {assessment.disruption.supplier_name} ·{" "}
                  {assessment.disruption.disruption_type.replace(/_/g, " ")} ·{" "}
                  {assessment.disruption.delay_days} day delay
                </span>
              </div>

              {assessment.summary ? (
                <p className="rounded-xl border border-line bg-[#FBFAF6] px-4 py-3 text-[13px] leading-relaxed text-ink">
                  {assessment.summary}
                </p>
              ) : null}

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="label mb-2">Affected warehouses</p>
                  <ul className="space-y-2">
                    {assessment.affected_warehouses.slice(0, 4).map((row, index) => (
                      <li
                        key={`${row.warehouse_id}-${row.warehouse_code}-${index}`}
                        className="rounded-xl border border-line px-3.5 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-forest-900">
                            {row.warehouse_name}
                          </span>
                          <Badge value={row.risk} kind="alert" />
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-stone">
                          {num(row.available_stock)} available · {num(row.days_until_delivery, 1)} d
                          cover · shortfall {num(row.projected_shortfall)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="label mb-2">Alternative suppliers</p>
                  {assessment.alternative_suppliers.length ? (
                    <ul className="space-y-2">
                      {assessment.alternative_suppliers.slice(0, 3).map((alt) => (
                        <li
                          key={alt.supplier_id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5"
                        >
                          <div>
                            <p className="text-[13px] font-medium text-forest-900">
                              {alt.supplier_name}
                            </p>
                            <p className="text-[11px] text-stone">
                              {alt.lead_time_days} d lead · reliability{" "}
                              {alt.reliability_score.toFixed(2)}
                            </p>
                          </div>
                          <Badge value={alt.eligible ? "eligible" : "blocked"} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-[12px] text-stone">
                      No alternative supplier on file for this product.
                    </p>
                  )}
                </div>
              </div>

              {assessment.transfer_suggestion ? (
                <div className="rounded-xl border border-[#D7E6DB] bg-forest-50/70 p-4">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-forest-900">
                    <ArrowRight className="h-3.5 w-3.5" /> Internal transfer option
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-stone">
                    {assessment.transfer_suggestion.explanation}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
                    <span>
                      Allocated{" "}
                      <strong className="tabular-nums">
                        {num(assessment.transfer_suggestion.allocated_quantity)}
                      </strong>{" "}
                      / {num(assessment.transfer_suggestion.requested_quantity)}
                    </span>
                    <span>
                      Unmet{" "}
                      <strong className="tabular-nums">
                        {num(assessment.transfer_suggestion.unmet_quantity)}
                      </strong>
                    </span>
                    <Badge
                      value={assessment.transfer_suggestion.feasible ? "feasible" : "partial"}
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="label mb-2">Affected products</p>
                  <ul className="space-y-1.5">
                    {assessment.affected_products.slice(0, 4).map((product) => (
                      <li
                        key={`${product.product_id}-${product.sku}`}
                        className="flex items-center justify-between gap-2 text-[12px]"
                      >
                        <span className="text-ink">
                          {product.sku} · {product.product_name}
                        </span>
                        <span className="text-stone">
                          lead {product.base_lead_time_days} → {product.effective_lead_time_days} d
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="label mb-2">Recovery actions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {assessment.recovery.actions.map((action) => (
                      <span
                        key={action}
                        className="badge bg-[#EDF4EF] text-[#2F6B4A]"
                      >
                        <CheckCircle2 className="h-3 w-3" /> {action.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-stone">
                    {assessment.recovery.rationale}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card
        className="mt-6"
        title="Active disruptions"
        description="Only events inside their active window are assessed by the workflow"
        actions={
          <span className="flex items-center gap-1.5 text-[11px] text-stone">
            <ShieldCheck className="h-3.5 w-3.5" /> {num(activeCount)} open
          </span>
        }
        bodyClassName="pb-2"
      >
        {active.loading && !active.data ? <LoadingPanel rows={3} /> : null}
        {active.error ? <ErrorPanel message={active.error} onRetry={active.reload} /> : null}
        {active.data && active.data.length === 0 ? (
          <EmptyPanel message="No active disruptions. Simulate one above, or run the demonstration scenario." />
        ) : null}
        {active.data?.length ? (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="text-right">Delay</th>
                  <th>Severity</th>
                  <th>Started</th>
                  <th>Expected recovery</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.data.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular-nums text-[12px] text-stone">DR-{row.id}</td>
                    <td className="font-medium">{row.supplier_name}</td>
                    <td className="text-[12px] text-stone">{row.sku ?? "All products"}</td>
                    <td className="text-[12px]">{row.disruption_type.replace(/_/g, " ")}</td>
                    <td className="text-right tabular-nums">{row.delay_days} d</td>
                    <td>
                      <Badge value={row.severity} kind="alert" />
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-stone">
                      {formatDate(row.started_at)}
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-stone">
                      {formatDate(row.expected_resolution_date)}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => loadAssessment(row.id)}
                      >
                        Assess
                      </button>
                      <button
                        className="btn-ghost btn-sm !text-[#2F6B4A]"
                        onClick={() => resolve(row.id)}
                      >
                        Resolve
                      </button>
                    </td>
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
