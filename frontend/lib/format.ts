/**
 * Locale helpers for an Indian SME distributor.
 *
 * Every amount is Indian Rupees formatted with the Indian numbering system
 * (`en-IN`), and every timestamp is rendered in Asia/Kolkata as DD/MM/YYYY.
 */

const LOCALE = "en-IN";
const TIME_ZONE = "Asia/Kolkata";

export const CURRENCY_CODE = "INR";
export const CURRENCY_SYMBOL = "₹";

export function num(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Indian Rupees with the Indian digit grouping, e.g. ₹12,45,000. */
export function money(
  value: number | null | undefined,
  options: { digits?: 0 | 1 | 2; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const formatted = new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: CURRENCY_CODE,
    maximumFractionDigits: options.digits ?? 0,
    minimumFractionDigits: options.digits ?? 0,
  }).format(Math.abs(value));
  const sign = value < 0 ? "−" : options.signed && value > 0 ? "+" : "";
  return `${sign}${formatted}`;
}

/** Compact rupee label for axis ticks and dense chips: ₹4.2L, ₹1.1Cr. */
export function moneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Units with Indian grouping and a metric unit label. */
export function units(value: number | null | undefined, unit = "units"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${num(value)} ${unit}`;
}

export function percent(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function ratioPercent(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** DD/MM/YYYY in Asia/Kolkata. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const parsed = value instanceof Date ? value : toDate(value);
  if (!parsed) return typeof value === "string" ? value : "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(parsed);
}

/** DD/MM/YYYY, HH:mm in Asia/Kolkata (24-hour clock). */
export function dateTime(value: string | null | undefined): string {
  const parsed = toDate(value);
  if (!parsed) return value ? String(value) : "—";
  const date = formatDate(parsed);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(parsed);
  return `${date}, ${time}`;
}

/** Short axis label: 08 Nov. */
export function dayLabel(value: string | null | undefined): string {
  const parsed = toDate(value);
  if (!parsed) return value ? String(value) : "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: TIME_ZONE,
  }).format(parsed);
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = toDate(value)?.getTime();
  if (!parsed) return String(value);
  const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Today, rendered for the top navigation bar. */
export function todayLabel(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(now);
}

export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: TIME_ZONE,
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export const ALERT_LABELS: Record<string, string> = {
  critical: "Critical",
  stockout: "Stockout",
  low: "Low stock",
  overstock: "Overstock",
  ok: "Healthy",
};

export const ALERT_STYLES: Record<string, string> = {
  critical: "bg-[#FBEDEC] text-[#A9443E]",
  stockout: "bg-[#FBEDEC] text-[#A9443E]",
  low: "bg-[#FBF3E4] text-[#94651F]",
  overstock: "bg-[#EEF3F7] text-[#41637A]",
  ok: "bg-[#EDF4EF] text-[#2F6B4A]",
};

export const STATUS_STYLES: Record<string, string> = {
  completed: "bg-[#EDF4EF] text-[#2F6B4A]",
  approved: "bg-[#EDF4EF] text-[#2F6B4A]",
  passed: "bg-[#EDF4EF] text-[#2F6B4A]",
  resolved: "bg-[#EDF4EF] text-[#2F6B4A]",
  active: "bg-[#FBF3E4] text-[#94651F]",
  running: "bg-[#EEF3F7] text-[#41637A]",
  queued: "bg-[#F2F2ED] text-[#6C746E]",
  pending: "bg-[#F2F2ED] text-[#6C746E]",
  failed: "bg-[#FBEDEC] text-[#A9443E]",
  rejected: "bg-[#FBEDEC] text-[#A9443E]",
  requires_review: "bg-[#FBF3E4] text-[#94651F]",
  eligible: "bg-[#EDF4EF] text-[#2F6B4A]",
  blocked: "bg-[#FBEDEC] text-[#A9443E]",
  recommended: "bg-[#E4EDE7] text-[#26503F]",
  feasible: "bg-[#EDF4EF] text-[#2F6B4A]",
  partial: "bg-[#FBF3E4] text-[#94651F]",
};

export const CHART_INK = "#183D32";
export const CHART_SAGE = "#A6C7A9";
export const CHART_MUTED = "#C9CEC7";
export const CHART_AMBER = "#D89A39";
export const CHART_DANGER = "#C65B55";
