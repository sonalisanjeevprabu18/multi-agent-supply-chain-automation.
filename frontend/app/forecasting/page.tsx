"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Brain, RefreshCcw, Upload } from "lucide-react";
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
import { ApiError, apiPost, apiUpload } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { num, percent } from "@/lib/format";
import type {
  ForecastResult,
  Product,
  ReportSummary,
  TrainReport,
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
  const [horizon, setHorizon] = useState(14);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const products = useApi<Product[]>("/api/products");
  const metrics = useApi<MetricsRegistry>("/api/forecast/metrics");
  const results = useApi<ForecastResult[]>("/api/forecast/results");
  const summary = useApi<ReportSummary>("/api/reports/summary");
  const backtest = useApi<Backtest>(
    productId ? `/api/forecast/backtest/${productId}?days=28` : null,
  );

  const selected = useMemo(() => {
    if (!results.data) return null;
    if (productId) return results.data.find((r) => r.product_id === productId) ?? null;
    return results.data[0] ?? null;
  }, [results.data, productId]);

  const chartData = useMemo(() => {
    if (!backtest.data) return [];
    return backtest.data.dates.map((date, index) => ({
      date: date.slice(5),
      actual: backtest.data!.actual[index],
      predicted: backtest.data!.predicted[index],
    }));
  }, [backtest.data]);

  const forecastData = useMemo(
    () =>
      (selected?.predictions ?? []).map((point) => ({
        date: point.date.slice(5),
        units: point.predicted_units,
      })),
    [selected],
  );

  async function upload(file: File) {
    setBusy("upload");
    try {
      const response = await apiUpload<{ accepted_rows: number; warnings: string[] }>(
        "/api/sales/upload",
        file,
      );
      setToast({
        message: `Ingested ${response.accepted_rows} sales row(s).${
          response.warnings.length ? ` ${response.warnings.length} warning(s).` : ""
        }`,
        tone: "success",
      });
      products.reload?.();
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
      const start = await apiPost<{ status: string }>(
        "/api/forecast/train?background=true",
        {},
      );
      if (start.status === "completed") {
        setToast({ message: "Models trained.", tone: "success" });
      } else {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const status = await (await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/forecast/train/status`,
            { cache: "no-store" },
          )).json() as TrainStatus;
          if (status.status === "completed") break;
          if (status.status === "failed") throw new Error(status.error || "Training failed");
        }
        setToast({ message: "Training finished. Metrics refreshed.", tone: "success" });
      }
      metrics.reload?.();
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
        title="Demand forecasting"
        subtitle="XGBoost regressors per product with a moving-average baseline. Models are trained offline and persisted; prediction only loads artifacts. Features use lags of 1/7/14 days and rolling means of 7/14/30 with a chronological split."
        actions={
          <>
            <label className="btn-secondary cursor-pointer">
              <Upload className="h-4 w-4" />
              {busy === "upload" ? "Uploading…" : "Upload sales CSV"}
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
            <button className="btn-secondary" onClick={trainModels} disabled={busy !== null}>
              <RefreshCcw className="h-4 w-4" />
              {busy === "train" ? "Training…" : "Train models"}
            </button>
            <button className="btn-primary" onClick={generateForecast} disabled={busy !== null}>
              <Brain className="h-4 w-4" />
              {busy === "predict" ? "Forecasting…" : "Generate forecast"}
            </button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Models trained"
          value={num(summary.data?.forecasting.models_trained ?? metrics.data?.n_trained ?? 0)}
          hint={`${num(metrics.data?.n_fallback ?? 0)} using moving-average fallback`}
          tone="brand"
        />
        <MetricCard
          label="Avg XGBoost WAPE"
          value={
            summary.data?.forecasting.avg_xgboost_wape != null
              ? percent(summary.data.forecasting.avg_xgboost_wape)
              : "—"
          }
          hint="Lower is better"
          tone="success"
        />
        <MetricCard
          label="Avg baseline WAPE"
          value={
            summary.data?.forecasting.avg_baseline_wape != null
              ? percent(summary.data.forecasting.avg_baseline_wape)
              : "—"
          }
          hint="Seasonal-naive moving average"
        />
        <MetricCard
          label="Forecast rows stored"
          value={num(summary.data?.forecasting.persisted_forecast_rows ?? 0)}
          hint="demand_forecasts table"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          title="Actual vs predicted (one-step-ahead backtest)"
          description={
            backtest.data
              ? `${backtest.data.sku} · ${backtest.data.model} · last ${backtest.data.days} days`
              : "Select a product to backtest the persisted model"
          }
          className="xl:col-span-2"
          actions={
            <select
              className="field !w-auto"
              value={productId ?? ""}
              onChange={(event) =>
                setProductId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">Select product…</option>
              {(products.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          }
        >
          {backtest.loading ? <LoadingState label="Backtesting…" /> : null}
          {backtest.error ? <ErrorState message={backtest.error} /> : null}
          {!productId ? (
            <EmptyState message="Choose a product to compare real demand against the persisted model." />
          ) : null}
          {backtest.data ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    stroke="#6366f1"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          {backtest.data ? (
            <p className="mt-3 text-xs muted">
              Backtest MAE {backtest.data.metrics.mae}, RMSE {backtest.data.metrics.rmse}, WAPE{" "}
              {percent(backtest.data.metrics.wape)}. Each point is predicted from prior days only.
            </p>
          ) : null}
        </Card>

        <Card title="Forecast controls" description="Horizon selection for persisted predictions">
          <label className="text-xs font-semibold uppercase tracking-wide muted">Horizon (days)</label>
          <select
            className="field mt-1"
            value={horizon}
            onChange={(event) => setHorizon(Number(event.target.value))}
          >
            {[7, 14, 30].map((value) => (
              <option key={value} value={value}>
                Next {value} days
              </option>
            ))}
          </select>
          <div className="mt-4 rounded-lg border border-dashed p-4 text-xs muted">
            <p className="font-semibold text-[rgb(var(--text))]">Model comparison</p>
            {metrics.data?.products?.length ? (
              <ul className="mt-2 space-y-1">
                {metrics.data.products.slice(0, 4).map((item) => (
                  <li key={String(item.product_id)} className="flex justify-between gap-2">
                    <span>{item.sku}</span>
                    <span>
                      XGB {item.metrics.xgboost ? percent(item.metrics.xgboost.wape) : "—"} · MA{" "}
                      {item.metrics.moving_average
                        ? percent(item.metrics.moving_average.wape)
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2">No metrics yet — train the models first.</p>
            )}
          </div>
          {selected ? (
            <p className="mt-4 text-xs muted">
              Latest persisted forecast: {selected.sku} using{" "}
              <Badge value={selected.model} kind="plain" /> ·{" "}
              {selected.fallback ? "baseline fallback" : "XGBoost"} ·{" "}
              {num(selected.total_predicted_units)} units over {selected.horizon_days} days.
            </p>
          ) : null}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card
          title="Predicted daily demand"
          description={selected ? `${selected.sku} · horizon ${selected.horizon_days} days` : undefined}
          className="xl:col-span-2"
        >
          {results.loading && !results.data ? <LoadingState /> : null}
          {results.error ? <ErrorState message={results.error} onRetry={results.reload} /> : null}
          {results.data && results.data.length === 0 ? (
            <EmptyState message="No forecasts stored yet. Generate a forecast to populate this chart." />
          ) : null}
          {forecastData.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="units" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </Card>

        <Card title="Product-wise predictions" description="Latest batch per product">
          {results.data?.length ? (
            <div className="-mx-5 max-h-72 overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Model</th>
                    <th className="text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {results.data.map((row) => (
                    <tr key={row.product_id}>
                      <td className="font-medium">{row.sku}</td>
                      <td>
                        <Badge value={row.model} kind="plain" />
                      </td>
                      <td className="text-right tabular-nums">{num(row.total_predicted_units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No persisted forecasts." />
          )}
        </Card>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
