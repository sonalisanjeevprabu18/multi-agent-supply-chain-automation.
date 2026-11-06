"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { ALERT_STYLES, STATUS_STYLES } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title || actions ? (
        <div className="panel-header">
          <div>
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success" | "brand";
  icon?: ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "text-[rgb(var(--text))]",
    danger: "text-rose-600 dark:text-rose-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    brand: "text-brand-600 dark:text-brand-400",
  };
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide muted">{label}</p>
        {icon ? <span className="muted">{icon}</span> : null}
      </div>
      <p className={`mt-3 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs muted">{hint}</p> : null}
    </div>
  );
}

export function Badge({ value, kind = "status" }: { value: string; kind?: "status" | "alert" | "plain" }) {
  const key = (value || "").toLowerCase();
  const palette =
    kind === "alert" ? ALERT_STYLES[key] : kind === "status" ? STATUS_STYLES[key] : undefined;
  return (
    <span className={`badge ${palette || "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300"}`}>
      {value || "—"}
    </span>
  );
}

export function LoadingState({ label = "Loading live data…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-sm muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        {message}
      </span>
      {onRetry ? (
        <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm muted">
      {message}
    </div>
  );
}

export function Toast({
  message,
  tone = "success",
  onClose,
}: {
  message: string;
  tone?: "success" | "error";
  onClose: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-card ${
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
      }`}
    >
      <div className="flex items-start gap-3">
        <p className="flex-1">{message}</p>
        <button type="button" onClick={onClose} className="text-xs font-semibold uppercase">
          close
        </button>
      </div>
    </div>
  );
}
