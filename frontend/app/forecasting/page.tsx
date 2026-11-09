"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Brain, Loader2, RefreshCcw, UploadCloud } from "lucide-react";
import {
  Badge,
  Card,
  EmptyPanel,
  ErrorPanel,
  Field,
  KpiCard,
  LoadingPanel,
  PageHeader,
  Segmented,
  SortHeader,
  StatRow,
  TableWrap,
  Toast,
} from "@/components/ui";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS } from "@/components/charts";
import { ApiError, apiPost, apiUpload } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { dayLabel, num, percent } from "@/lib/format";
import type {
  ForecastResult,
  InventoryRow,
  Product,
  ReportSummary,
  TrainReport,
  Warehouse,
} from "@/types";

type MetricsRegistry = {
  trained_at: string | null;
  n_products: number;
  n_trained: number;
  n_fallback: number;
  products: TrainReport[];
};

type Backtest = {
  sku: string;
  model: string;
  days: number;
  dates: string[];
  actual: number[];
  predicted: number[];
  metrics: { mae: number; rmse: number; wape: number };
};

type TrainStatus = {
  status: string;
  error: string | null;
  result: MetricsRegistry | null;
};

export default function ForecastingPage() {
  const [productId, setProductId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [horizon, setHorizon] = useState(14);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sort, setSort] = useState<{ key: "sku" | "units"; dir: "asc" | "desc" }>({
    key: "sku",
    dir: "asc",
  });
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const products = useApi<Product[]>("/api/products");
  const warehouses = useApi<Warehouse[]>("/api/warehouses");
  const metrics = useApi<MetricsRegistry>("/api/forecast/metrics");
  const results = useApi<ForecastResult[]>("/api/forecast/results");
  const summary = useApi<ReportSummary>("/api/reports/summary");

  useEffect(() => {
    if (!productId && products.data?.length) setProductId(products.data[0].id);
  }, [products.data, productId]);

  const backtest = useApi<Backtest>(
    productId ? `/api/forecast/backtest/${productId}?days=28` : null,
  );
  const stockContext = useApi<InventoryRow[]>(
    productId ? `/api/inventory?product_id=${productId}` : null,
  );

  const selectedResult = useMemo(
    () => results.data?.find((row) => row.product_id === productId) ?? null,
    [results.data, productId],
  );

  const backtestData = useMemo(() => {
    if (!backtest.data) return [];
    return backtest.data.dates.map((date, index) => ({
      label: dayLabel(date),
      actual: backtest.data!.actual[index],
      predicted: backtest.data!.predicted[index],
    }));
  }, [backtest.data]);

  const forecastData = useMemo(
    () =>
      (selectedResult?.predictions ?? []).map((point) => ({
        label: dayLabel(point.date),
        units: point.predicted_units,
      })),
    [selectedResult],
  );

  const comparison = useMemo(() => {
    const rows = metrics.data?.products ?? [];
    return rows
      .filter((row) => row.metrics?.xgboost && row.metrics?.moving_average)
      .slice(0, 8)
      .map((row) => ({
        sku: row.sku,
        xgboost: Number(((row.metrics.xgboost?.wape ?? 0) * 100).toFixed(2)),
        baseline: Number(((row.metrics.moving_average?.wape ?? 0) * 100).toFixed(2)),
        improvement: row.comparison?.wape_improvement ?? null,
      }));
  }, [metrics.data]);

  const forecastRows = useMemo(() => {
    const rows = [...(results.data ?? [])];
    rows.sort((a, b) => {
      if (sort.key === "sku") return a.sku.localeCompare(b.sku) * (sort.dir === "asc" ? 1 : -1);
      return (a.total_predicted_units - b.total_predicted_units) * (sort.dir === "asc" ? 1 : -1);
    });
    return rows;
  }, [results.data, sort]);

  const stockRow =
    stockContext.data?.find((row) => !warehouseId || row.warehouse_id === warehouseId) ?? null;

  async function upload(file: File) {
    setBusy("upload");
    try {
      const response = await apiUpload<{ accepted_rows: number; warnings: string[] }>(
        "/api/sales/upload",
        file,
      );
      setToast({
        message: `Ingested ${num(response.accepted_rows)} sales row(s)${
          response.warnings.length ? ` with ${response.warnings.length} warning(s)` : ""
        }. Re-train the models to use the new history.`,
        tone: "success",
      });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Upload failed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function trainModels() {
    setBusy("train");
    try {
      const start = await apiPost<{ status: string }>("/api/forecast/train?background=true", {});
      if (start.status !== "completed") {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const status = (await (
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/forecast/train/status`, {
              cache: "no-store",
            })
          ).json()) as TrainStatus;
          if (status.status === "completed") break;
          if (status.status === "failed") throw new Error(status.error || "Training failed");
        }
      }
      metrics.reload?.();
      summary.reload?.();
      setToast({ message: "Models trained and metrics refreshed.", tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function generateForecast() {
    setBusy("predict");
    try {
      await apiPost<ForecastResult[]>("/api/forecast/predict", {
        product_ids: productId ? [productId] : null,
        horizon_days: horizon,
        persist: true,
      });
      results.reload?.();
      summary.reload?.();
      setToast({ message: `Forecast generated for the next ${horizon} days.`, tone: "success" });
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Forecast failed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Demand Forecasting"
        subtitle="One XGBoost regressor per product, benchmarked against a moving average. Features use 1/7/14-day lags and 7/14/30-day rolling means with a chronological split."
        actions={
          <>
            <button className="btn-outline" onClick={trainModels} disabled={busy !== null}>
              {busy === "train" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              {busy === "train" ? "Training…" : "Train models"}
            </button>
            <button className="btn-primary" onClick={generateForecast} disabled={busy !== null}>
              <Brain className="h-4 w-4" />
              {busy === "predict" ? "Forecasting…" : "Generate Forecast"}
            </button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="MAE"
          value={backtest.data ? num(backtest.data.metrics.mae, 1) : "—"}
          hint="Mean absolute error, units"
          loading={backtest.loading && !backtest.data}
        />
        <KpiCard
          label="RMSE"
          value={backtest.data ? num(backtest.data.metrics.rmse, 1) : "—"}
          hint="Root mean squared error, units"
          loading={backtest.loading && !backtest.data}
        />
        <KpiCard
          label="WAPE"
          value={backtest.data ? percent(backtest.data.metrics.wape) : "—"}
          hint="Weighted absolute percentage error"
          tone="brand"
          loading={backtest.loading && !backtest.data}
        />
        <KpiCard
          label="Models trained"
          value={num(summary.data?.forecasting.models_trained ?? metrics.data?.n_trained ?? 0)}
          hint={`${num(metrics.data?.n_fallback ?? 0)} on moving-average fallback`}
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Forecast controls" description="Scope the workspace">
            <div className="space-y-4">
              <Field label="Product">
                <select
                  className="field"
                  value={productId ?? ""}
                  onChange={(event) => setProductId(Number(event.target.value))}
                >
                  {(products.data ?? []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Warehouse context" hint="Stock position shown beside the forecast">
                <select
                  className="field"
                  value={warehouseId}
                  onChange={(event) =>
                    setWarehouseId(event.target.value ? Number(event.target.value) : "")
                  }
                >
                  <option value="">All warehouses</option>
                  {(warehouses.data ?? []).map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} · {warehouse.location}
                    </option>
                  ))}
                </select>
              </Field>
              <div>
                <span className="label mb-1.5 block">Forecast horizon</span>
                <Segmented
                  options={[
                    { value: 7, label: "7 days" },
                    { value: 14, label: "14 days" },
                    { value: 30, label: "30 days" },
                  ]}
                  value={horizon}
                  onChange={setHorizon}
                />
              </div>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) upload(file);
                }}
                className={`rounded-xl border border-dashed px-4 py-5 text-center transition ${
                  dragging ? "border-forest-400 bg-forest-50" : "border-line bg-[#FBFAF6]"
                }`}
              >
                <UploadCloud className="mx-auto h-5 w-5 text-forest-500" />
                <p className="mt-2 text-[13px] font-medium text-forest-900">Upload sales CSV</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-stone">
                  Columns: date, sku, quantity, warehouse_code. Rows append to sales history.
                </p>
                <label className="btn-outline btn-sm mt-3 cursor-pointer">
                  {busy === "upload" ? "Uploading…" : "Choose file"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) upload(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </Card>

          <Card title="Stock context" description={stockRow ? stockRow.warehouse_name : "Current position"}>
            {stockContext.loading && !stockContext.data ? (
              <LoadingPanel rows={4} />
            ) : stockRow ? (
              <dl>
                <StatRow label="Available" value={num(stockRow.available_stock)} />
                <StatRow label="Incoming" value={num(stockRow.incoming_stock)} />
                <StatRow label="Safety stock" value={num(stockRow.safety_stock)} />
                <StatRow label="Reorder point" value={num(stockRow.reorder_point)} />
                <StatRow
                  label="Days of cover"
                  value={stockRow.days_of_cover === null ? "—" : `${num(stockRow.days_of_cover, 1)} d`}
                />
                <StatRow
                  label="Recommended order"
                  value={num(stockRow.recommended_order_quantity)}
                  tone={stockRow.recommended_order_quantity > 0 ? "warn" : "default"}
                />
              </dl>
            ) : (
              <p className="text-xs text-stone">No stock row for this product and warehouse.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title="Actual vs predicted demand"
            description={
              backtest.data
                ? `${backtest.data.sku} · ${backtest.data.model} · one-step-ahead backtest over ${backtest.data.days} days`
                : "Select a product to backtest the persisted model"
            }
            actions={
              backtest.data ? (
                <Badge value={backtest.data.model} kind="outline" />
              ) : null
            }
          >
            {backtest.loading && !backtest.data ? (
              <LoadingPanel rows={6} label="Running backtest…" />
            ) : null}
            {backtest.error ? <ErrorPanel message={backtest.error} /> : null}
            {backtestData.length ? (
              <>
                <div className="mb-3">
                  <ChartLegend
                    items={[
                      { label: "Actual units", color: "#183D32" },
                      { label: "Predicted units", color: "#A6C7A9", dashed: true },
                    ]}
                  />
                </div>
                <ResponsiveContainer width="100%" height={288}>
                  <LineChart data={backtestData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={24} />
                    <YAxis {...AXIS_PROPS} width={44} />
                    <Tooltip
                      content={<ChartTooltip formatter={(value) => `${num(value)} units`} />}
                    />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="Actual"
                      stroke="#183D32"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted"
                      name="Predicted"
                      stroke="#A6C7A9"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : null}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title="Forecast demand"
              description={
                selectedResult
                  ? `${selectedResult.sku} · next ${selectedResult.horizon_days} days · ${num(
                      selectedResult.total_predicted_units,
                    )} units`
                  : "Persisted prediction batches"
              }
            >
              {forecastData.length ? (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={forecastData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={18} />
                    <YAxis {...AXIS_PROPS} width={44} />
                    <Tooltip
                      cursor={{ fill: "rgba(24,61,50,0.04)" }}
                      content={<ChartTooltip formatter={(value) => `${num(value)} units`} />}
                    />
                    <Bar dataKey="units" name="Forecast" fill="#315C49" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyPanel message="No stored forecast for this product. Generate one to plot daily demand." />
              )}
              {selectedResult ? (
                <p className="mt-3 border-t border-line pt-3 text-[11px] text-stone">
                  {selectedResult.fallback ? "Baseline fallback" : "XGBoost"} · avg{" "}
                  {num(selectedResult.avg_daily_demand, 1)} units/day · confidence derived from a
                  chronological holdout.
                </p>
              ) : null}
            </Card>

            <Card
              title="XGBoost vs moving average"
              description="Holdout WAPE by product, lower is better"
            >
              {comparison.length ? (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart
                    data={comparison}
                    margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
                    barGap={4}
                  >
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="sku" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} width={44} unit="%" />
                    <Tooltip
                      cursor={{ fill: "rgba(24,61,50,0.04)" }}
                      content={<ChartTooltip formatter={(value) => `${value.toFixed(1)}%`} />}
                    />
                    <Bar dataKey="xgboost" name="XGBoost" fill="#183D32" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="baseline" name="Moving average" fill="#CBDDD2" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyPanel message="No trained metrics yet. Train the models to compare WAPE." />
              )}
              <div className="mt-3 border-t border-line pt-3">
                <ChartLegend
                  items={[
                    { label: "XGBoost", color: "#183D32" },
                    { label: "Moving average", color: "#CBDDD2" },
                  ]}
                />
              </div>
            </Card>
          </div>

          <Card
            title="Product-wise forecasts"
            description="Latest persisted batch per product"
            bodyClassName="pb-2"
          >
            {results.loading && !results.data ? <LoadingPanel rows={5} /> : null}
            {results.error ? <ErrorPanel message={results.error} onRetry={results.reload} /> : null}
            {results.data && results.data.length === 0 ? (
              <EmptyPanel message="No forecasts stored yet. Generate a forecast to populate this table." />
            ) : null}
            {forecastRows.length ? (
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
                      <th>Model</th>
                      <th className="text-right">Avg daily</th>
                      <SortHeader
                        label="Forecast units"
                        active={sort.key === "units"}
                        direction={sort.dir}
                        align="right"
                        onClick={() =>
                          setSort((current) => ({
                            key: "units",
                            dir: current.key === "units" && current.dir === "asc" ? "desc" : "asc",
                          }))
                        }
                      />
                      <th className="text-right">Horizon</th>
                      <th className="text-right">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastRows.map((row) => (
                      <tr key={row.product_id} className={row.product_id === productId ? "bg-forest-50/60" : ""}>
                        <td>
                          <p className="font-medium text-ink">{row.sku}</p>
                          <p className="text-[11px] text-stone">{row.product_name}</p>
                        </td>
                        <td>
                          <Badge value={row.model} kind="outline" />
                        </td>
                        <td className="text-right tabular-nums">{num(row.avg_daily_demand, 1)}</td>
                        <td className="text-right font-semibold tabular-nums text-forest-900">
                          {num(row.total_predicted_units)}
                        </td>
                        <td className="text-right tabular-nums text-stone">{row.horizon_days} d</td>
                        <td className="text-right">
                          <Badge
                            value={row.fallback ? "baseline" : "xgboost"}
                            kind="plain"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : null}
          </Card>

          {metrics.data?.products?.length ? (
            <Card title="Model evaluation detail" description="Holdout metrics for every trained product">
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Observations</th>
                      <th className="text-right">XGB WAPE</th>
                      <th className="text-right">MA WAPE</th>
                      <th className="text-right">Improvement</th>
                      <th className="text-right">Best</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.data.products.slice(0, 10).map((row) => (
                      <tr key={String(row.product_id)}>
                        <td>
                          <p className="font-medium">{row.sku}</p>
                          <p className="text-[11px] text-stone">{row.product_name ?? "—"}</p>
                        </td>
                        <td className="text-right tabular-nums">{num(row.observations)}</td>
                        <td className="text-right tabular-nums">
                          {row.metrics.xgboost ? percent(row.metrics.xgboost.wape) : "—"}
                        </td>
                        <td className="text-right tabular-nums text-stone">
                          {row.metrics.moving_average
                            ? percent(row.metrics.moving_average.wape)
                            : "—"}
                        </td>
                        <td className="text-right tabular-nums">
                          {row.comparison?.wape_improvement != null
                            ? percent(row.comparison.wape_improvement)
                            : "—"}
                        </td>
                        <td className="text-right">
                          <Badge value={row.comparison?.best_model ?? "—"} kind="plain" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <p className="mt-3 px-1 text-[11px] text-stone">
                Metrics come from a chronological holdout: the model only ever predicts days it has
                not seen. All monetary values in this workspace are Indian Rupees.
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
