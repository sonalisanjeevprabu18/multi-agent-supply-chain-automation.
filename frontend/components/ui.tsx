"use client";

import { useEffect, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { ALERT_STYLES, STATUS_STYLES } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
  aside,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {aside}
        {actions}
      </div>
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "p-5",
  id,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`card ${className}`}>
      {title || actions ? (
        <div className="card-head">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-display text-[15px] font-semibold text-forest-900">{title}</h2>
            ) : null}
            {description ? <p className="mt-0.5 text-xs text-stone">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const KPI_TONES = {
  neutral: { value: "text-forest-900", icon: "bg-forest-50 text-forest-600" },
  brand: { value: "text-forest-700", icon: "bg-forest-50 text-forest-600" },
  success: { value: "text-[#2F6B4A]", icon: "bg-[#EDF4EF] text-[#2F6B4A]" },
  warning: { value: "text-[#94651F]", icon: "bg-[#FBF3E4] text-[#94651F]" },
  danger: { value: "text-[#A9443E]", icon: "bg-[#FBEDEC] text-[#A9443E]" },
} as const;

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  delta,
  loading = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: keyof typeof KPI_TONES;
  delta?: { value: string; direction: "up" | "down"; positive?: boolean };
  loading?: boolean;
}) {
  const palette = KPI_TONES[tone];
  return (
    <div className="card p-5 transition-shadow duration-300 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <p className="label">{label}</p>
        {icon ? (
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${palette.icon}`}>
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="skeleton mt-3 h-8 w-24" />
      ) : (
        <p className={`mt-2.5 font-display text-[26px] font-semibold leading-none ${palette.value}`}>
          {value}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {delta ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
              delta.positive === false ? "text-[#A9443E]" : "text-[#2F6B4A]"
            }`}
          >
            {delta.direction === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta.value}
          </span>
        ) : null}
        {hint ? <p className="text-[11px] leading-snug text-stone">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Badge({
  value,
  kind = "status",
  dot = false,
}: {
  value: string;
  kind?: "status" | "alert" | "plain" | "outline";
  dot?: boolean;
}) {
  const key = (value || "").toLowerCase().replace(/\s+/g, "_");
  if (kind === "outline") {
    return (
      <span className="badge border border-line bg-white text-forest-700">
        {dot ? <span className="h-1.5 w-1.5 rounded-full bg-forest-400" /> : null}
        {value || "—"}
      </span>
    );
  }
  const palette =
    kind === "alert"
      ? ALERT_STYLES[key]
      : kind === "status"
        ? STATUS_STYLES[key]
        : undefined;
  return (
    <span className={`badge ${palette ?? "bg-[#F2F2ED] text-[#6C746E]"}`}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> : null}
      {value ? value.replace(/_/g, " ") : "—"}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "idle" }) {
  const map = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    idle: "bg-line",
  } as const;
  return <span className={`h-2 w-2 shrink-0 rounded-full ${map[tone]}`} />;
}

export function Progress({
  value,
  tone = "forest",
  className = "",
}: {
  value: number;
  tone?: "forest" | "sage" | "warn" | "danger";
  className?: string;
}) {
  const palette = {
    forest: "bg-forest-600",
    sage: "bg-forest-300",
    warn: "bg-warn",
    danger: "bg-danger",
  } as const;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-[#EEEDE6] ${className}`}>
      <div
        className={`h-full rounded-full ${palette[tone]} transition-all duration-500`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-[#FAF9F5] p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-[10px] font-medium transition ${
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
          } ${
            value === option.value
              ? "bg-white text-forest-900 shadow-[0_1px_2px_rgba(24,61,50,0.12)]"
              : "text-stone hover:text-forest-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-stone">{hint}</span> : null}
    </label>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function LoadingPanel({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label ?? "Loading"}>
      <div className="flex items-center gap-2 text-xs text-stone">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {label ?? "Loading live data…"}
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F0D8D6] bg-[#FCF3F2] px-4 py-3 text-sm text-[#93433E]">
      <span className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </span>
      {onRetry ? (
        <button type="button" className="btn-outline btn-sm" onClick={() => onRetry()}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyPanel({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-[#FBFAF6] px-5 py-9 text-center">
      <Info className="h-4 w-4 text-stone" />
      <p className="max-w-sm text-sm text-stone">{message}</p>
      {action}
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
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose, message]);

  return (
    <div
      role="status"
      className={`fixed bottom-6 right-6 z-[60] flex max-w-sm animate-fade-up items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-lift ${
        tone === "success" ? "border-line" : "border-[#F0D8D6]"
      }`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          tone === "success"
            ? "bg-[#EDF4EF] text-[#2F6B4A]"
            : "bg-[#FBEDEC] text-[#A9443E]"
        }`}
      >
        {tone === "success" ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
      </span>
      <p className="flex-1 leading-relaxed text-ink">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-1 text-stone transition hover:text-forest-800"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 animate-fade-in bg-forest-900/35 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-[460px] animate-fade-up flex-col bg-white shadow-lift sm:animate-none">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 className="font-display text-base font-semibold text-forest-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-stone">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone transition hover:bg-forest-50 hover:text-forest-800"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-line px-6 py-4">{footer}</div> : null}
      </aside>
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function SortHeader({
  label,
  active,
  direction,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition hover:text-forest-800 ${
          active ? "text-forest-800" : ""
        }`}
      >
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${
            active && direction === "asc" ? "rotate-180" : ""
          } ${active ? "opacity-100" : "opacity-30"}`}
        />
      </button>
    </th>
  );
}

export function StatRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "danger" | "warn" | "success";
}) {
  const tones = {
    default: "text-forest-900",
    danger: "text-[#A9443E]",
    warn: "text-[#94651F]",
    success: "text-[#2F6B4A]",
  } as const;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="text-[13px] text-stone">{label}</dt>
      <dd className={`text-[13px] font-semibold tabular-nums ${tones[tone]}`}>{value}</dd>
    </div>
  );
}
