"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Zap } from "lucide-react";
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
import { num } from "@/lib/format";
import type { Disruption, DisruptionAssessment, Product, Supplier } from "@/types";

const TYPES = [
  "delivery_delay",
  "supplier_unavailable",
  "lead_time_increase",
  "reliability_reduction",
];

export default function DisruptionsPage() {
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [productId, setProductId] = useState<number | "">("");
  const [type, setType] = useState(TYPES[0]);
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
      setToast({ message: "Select a supplier to disrupt.", tone: "error" });
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
      setToast({ message: "Disruption simulated and assessed.", tone: "success" });
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
      setToast({ message: `Disruption ${id} resolved.`, tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Could not resolve.",
        tone: "error",
      });
    }
  }

  async function loadAssessment(id: number) {
    try {
      const { apiGet } = await import("@/lib/api");
      const response = await apiGet<DisruptionAssessment>(`/api/disruptions/${id}/assessment`);
      setAssessment(response);
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Assessment unavailable.",
        tone: "error",
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Supplier disruption management"
        subtitle="Simulate delays, unavailability, longer lead times or collapsing reliability. Each event is assessed against live stock and demand, then routed to alternative suppliers or internal transfers."
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Simulate a disruption" description="Recorded as a simulated planning event">
          <label className="mb-3 block text-xs font-semibold uppercase tracking-wide muted">
            Supplier
            <select
              className="field mt-1 font-normal normal-case"
              value={supplierId}
              onChange={(event) => setSupplierId(Number(event.target.value))}
            >
              <option value="">Select supplier…</option>
              {(suppliers.data ?? []).map((supplier) => (
                <option key={supplier.id} value={supplier.id} disabled={supplier.status !== "active"}>
                  {supplier.name} ({supplier.status})
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-wide muted">
            Product (optional)
            <select
              className="field mt-1 font-normal normal-case"
              value={productId}
              onChange={(event) => setProductId(event.target.value ? Number(event.target.value) : "")}
            >
              <option value="">All supplier products</option>
              {(products.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 block text-xs font-semibold uppercase tracking-wide muted">
            Disruption type
            <select
              className="field mt-1 font-normal normal-case"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {TYPES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide muted">
              Delay (days)
              <input
                type="number"
                min={0}
                max={90}
                className="field mt-1 font-normal"
                value={delayDays}
                onChange={(event) => setDelayDays(Number(event.target.value))}
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide muted">
              Reliability delta
              <input
                type="number"
                min={-1}
                max={0}
                step={0.05}
                className="field mt-1 font-normal"
                value={reliabilityDelta}
                onChange={(event) => setReliabilityDelta(Number(event.target.value))}
              />
            </label>
          </div>
          <button className="btn-primary w-full" onClick={simulate} disabled={busy}>
            <Zap className="h-4 w-4" />
            {busy ? "Assessing…" : "Simulate and assess"}
          </button>
        </Card>

        <Card
          title="Recovery recommendation"
          description="Derived from stockout risk, alternatives and transfer feasibility"
          className="xl:col-span-2"
        >
          {!assessment ? (
            <EmptyState message="Simulate a disruption (or open an active one) to see the recovery plan." />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge value={assessment.disruption.severity} kind="alert" />
                <Badge value={assessment.overall_stockout_risk} kind="alert" />
                <span className="text-xs muted">
                  {assessment.disruption.supplier_name} ·{" "}
                  {assessment.disruption.disruption_type.replace(/_/g, " ")} ·{" "}
                  {assessment.disruption.delay_days} day delay
                </span>
              </div>
              <p className="text-sm">{assessment.summary}</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide muted">
                    Affected warehouses
                  </p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {assessment.affected_warehouses.slice(0, 4).map((row) => (
                      <li
                        key={`${row.warehouse_id}-${row.warehouse_code}`}
                        className="rounded-lg border px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{row.warehouse_code}</span>
                          <Badge value={row.risk} kind="alert" />
                        </div>
                        <p className="mt-1 text-xs muted">
                          available {num(row.available_stock)} · wait {num(row.days_until_delivery, 1)}d
                          · projected shortfall {num(row.projected_shortfall)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide muted">
                    Alternative suppliers
                  </p>
                  {assessment.alternative_suppliers.length ? (
                    <ul className="mt-2 space-y-2 text-sm">
                      {assessment.alternative_suppliers.slice(0, 3).map((alt) => (
                        <li
                          key={alt.supplier_id}
                          className="flex items-center justify-between rounded-lg border px-3 py-2"
                        >
                          <span className="font-medium">{alt.supplier_name}</span>
                          <span className="text-xs muted">
                            {alt.score.toFixed(1)} · {alt.lead_time_days}d
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs muted">No alternative supplier on file.</p>
                  )}
                </div>
              </div>

              {assessment.transfer_suggestion ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 text-sm dark:border-brand-500/30 dark:bg-brand-500/10">
                  <p className="font-semibold">Transfer option</p>
                  <p className="mt-1 text-xs muted">{assessment.transfer_suggestion.explanation}</p>
                  <p className="mt-1 text-xs">
                    Allocated {num(assessment.transfer_suggestion.allocated_quantity)} /{" "}
                    {num(assessment.transfer_suggestion.requested_quantity)} units · unmet{" "}
                    {num(assessment.transfer_suggestion.unmet_quantity)}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide muted">Actions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {assessment.recovery.actions.map((action) => (
                    <span key={action} className="badge bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      <CheckCircle2 className="h-3 w-3" /> {action.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs muted">{assessment.recovery.rationale}</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Active disruptions"
        description="Only events whose status and date window are active are assessed by the workflow"
        className="mt-6"
      >
        {active.loading && !active.data ? <LoadingState /> : null}
        {active.error ? <ErrorState message={active.error} onRetry={active.reload} /> : null}
        {active.data && active.data.length === 0 ? (
          <EmptyState message="No active disruptions. Simulate one above, or run the demonstration scenario." />
        ) : null}
        {active.data?.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="text-right">Delay</th>
                  <th>Severity</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.data.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular-nums text-xs">{row.id}</td>
                    <td className="font-medium">{row.supplier_name}</td>
                    <td className="text-xs">{row.sku ?? "all"}</td>
                    <td className="text-xs">{row.disruption_type.replace(/_/g, " ")}</td>
                    <td className="text-right tabular-nums">{row.delay_days}d</td>
                    <td>
                      <Badge value={row.severity} kind="alert" />
                    </td>
                    <td className="text-xs muted">{row.started_at}</td>
                    <td className="space-x-2 text-right">
                      <button
                        className="text-xs font-semibold text-brand-600"
                        onClick={() => loadAssessment(row.id)}
                      >
                        assess
                      </button>
                      <button
                        className="text-xs font-semibold text-emerald-600"
                        onClick={() => resolve(row.id)}
                      >
                        resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-4 flex items-center gap-2 text-xs muted">
          <AlertTriangle className="h-3.5 w-3.5" />
          Simulated disruptions never contact a supplier and expire automatically after their window.
        </p>
      </Card>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
