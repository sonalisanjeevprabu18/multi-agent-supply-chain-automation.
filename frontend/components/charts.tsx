"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_DANGER, CHART_INK, CHART_MUTED, CHART_SAGE, num } from "@/lib/format";

export const CHART_COLORS = {
  ink: CHART_INK,
  sage: CHART_SAGE,
  muted: CHART_MUTED,
  danger: CHART_DANGER,
  amber: "#D89A39",
  blue: "#8FA9B8",
} as const;

export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: "#858D87" },
  tickLine: false,
  axisLine: { stroke: "#E6E8E1" },
} as const;

export const GRID_PROPS = {
  stroke: "#EDECE6",
  strokeDasharray: "3 4",
  vertical: false,
} as const;

type TooltipEntry = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

/** Neutral, rupee-aware tooltip used by every chart on the dashboard. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatter?: (value: number, name: string) => string;
  labelFormatter?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 shadow-lift">
      <p className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-stone">
        {labelFormatter && label !== undefined ? labelFormatter(label) : label}
      </p>
      <div className="space-y-1">
        {payload.map((entry, index) => {
          const value = Number(entry.value ?? 0);
          const name = String(entry.name ?? entry.dataKey ?? "");
          return (
            <div key={`${name}-${index}`} className="flex items-center gap-2 text-xs">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: entry.color ?? CHART_INK }}
              />
              <span className="capitalize text-stone">{name}</span>
              <span className="ml-auto font-semibold tabular-nums text-ink">
                {formatter ? formatter(value, name) : num(value, 1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Donut with a centred total; used for inventory health. */
export function DonutChart({
  data,
  centerLabel,
  centerValue,
  height = 208,
}: {
  data: Array<{ name: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string;
  height?: number;
}) {
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="66%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={(value) => `${num(value)} rows`} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-display text-[22px] font-semibold leading-none text-forest-900">
          {centerValue}
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-stone">{centerLabel}</p>
      </div>
    </div>
  );
}

/** Compact demand chart used on the overview. */
export function DemandAreaChart({
  data,
  height = 268,
}: {
  data: Array<{ label: string; actual: number | null; forecast: number | null }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_INK} stopOpacity={0.16} />
            <stop offset="100%" stopColor={CHART_INK} stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_SAGE} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART_SAGE} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={22} />
        <YAxis {...AXIS_PROPS} width={48} />
        <Tooltip content={<ChartTooltip formatter={(value) => `${num(value, 0)} units`} />} />
        <Area
          type="monotone"
          dataKey="actual"
          name="Actual"
          stroke={CHART_INK}
          strokeWidth={2}
          fill="url(#actualFill)"
          connectNulls={false}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="forecast"
          name="Forecast"
          stroke={CHART_SAGE}
          strokeWidth={2}
          strokeDasharray="5 4"
          fill="url(#forecastFill)"
          connectNulls={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ChartLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-stone">
          <span
            className="h-[3px] w-4 rounded-full"
            style={{
              background: item.dashed
                ? `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`
                : item.color,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({
  children,
  legend,
  footer,
}: {
  children: ReactNode;
  legend?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div>
      {legend ? <div className="mb-3">{legend}</div> : null}
      {children}
      {footer ? <div className="mt-3 border-t border-line pt-3">{footer}</div> : null}
    </div>
  );
}
