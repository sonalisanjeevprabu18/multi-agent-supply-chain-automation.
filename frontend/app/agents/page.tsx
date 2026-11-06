"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Toast,
} from "@/components/ui";
import { DemoRunner } from "@/components/DemoRunner";
import { ApiError, WORKFLOW_SYNC, apiGet, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { dateTime, num, timeAgo } from "@/lib/format";
import type { AgentExecution } from "@/types";

const AGENTS = [
  { key: "demand_forecasting_agent", label: "Demand Forecasting" },
  { key: "inventory_monitoring_agent", label: "Inventory Monitoring" },
  { key: "inventory_optimization_agent", label: "Inventory Optimization" },
  { key: "procurement_agent", label: "Procurement" },
  { key: "supplier_disruption_agent", label: "Supplier Disruption" },
  { key: "logistics_agent", label: "Logistics" },
  { key: "decision_verification_agent", label: "Decision Verification" },
];

export default function AgentsPage() {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [scenario, setScenario] = useState("disruption_demo");
  const [horizon, setHorizon] = useState(14);
  const [serviceLevel, setServiceLevel] = useState(0.95);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const history = useApi<Array<Record<string, unknown>>>("/api/agents/executions?limit=15");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("execution");
    if (requested) setExecutionId(requested);
  }, []);

  const loadExecution = useCallback(async (id: string, quiet = false) => {
    try {
      const response = await apiGet<AgentExecution>(`/api/agents/status/${id}`);
      setExecution(response);
      if (!quiet) setError(null);
      return response;
    } catch (err) {
      if (!quiet) {
        setError(err instanceof ApiError ? err.message : "Could not load that execution.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    loadExecution(executionId);

    const interval = setInterval(async () => {
      if (cancelled) return;
      const latest = await loadExecution(executionId, true);
      if (latest && ["completed", "failed"].includes(latest.status)) {
        clearInterval(interval);
        history.reload?.();
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionId, loadExecution]);

  async function execute() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiPost<AgentExecution>("/api/agents/execute", {
        scenario,
        horizon_days: horizon,
        service_level: serviceLevel,
        wait_for_completion: WORKFLOW_SYNC,
      });
      setExecutionId(response.execution_id);
      setExecution(response);
      history.reload?.();
      setToast({
        message:
          response.status === "completed"
            ? "Workflow completed."
            : "Workflow dispatched — polling for live progress.",
        tone: "success",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the workflow.");
    } finally {
      setBusy(false);
    }
  }

  const logsByAgent = useMemo(() => {
    const map = new Map<string, AgentExecution["logs"]>();
    for (const log of execution?.logs ?? []) {
      const list = map.get(log.agent_name) ?? [];
      list.push(log);
      map.set(log.agent_name, list);
    }
    return map;
  }, [execution]);

  const completed = new Set(
    (execution?.logs ?? []).filter((log) => log.status === "completed").map((log) => log.agent_name),
  );
  const activeAgent = AGENTS.find(
    (agent) => !completed.has(agent.key) && logsByAgent.has(agent.key),
  )?.key;

  return (
    <>
      <PageHeader
        title="Multi-agent monitoring"
        subtitle="LangGraph executes seven specialized agents over one shared state. Every step writes an agent_logs row; verification re-derives the constraints before any recommendation is approved."
        actions={<DemoRunner compact />}
      />

      <div className="grid gap-6 xl:grid-cols-4">
        <Card title="Execute workflow" description="Persisted execution + polling">
          <label className="mb-3 block text-xs font-semibold uppercase tracking-wide muted">
            Scenario
            <select
              className="field mt-1 font-normal normal-case"
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              <option value="disruption_demo">disruption_demo</option>
              <option value="standard_workflow">standard_workflow</option>
            </select>
          </label>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide muted">
              Horizon
              <select
                className="field mt-1 font-normal"
                value={horizon}
                onChange={(event) => setHorizon(Number(event.target.value))}
              >
                {[7, 14, 30].map((value) => (
                  <option key={value} value={value}>
                    {value}d
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide muted">
              Service level
              <select
                className="field mt-1 font-normal"
                value={serviceLevel}
                onChange={(event) => setServiceLevel(Number(event.target.value))}
              >
                {[0.9, 0.95, 0.98].map((value) => (
                  <option key={value} value={value}>
                    {(value * 100).toFixed(0)}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn-primary w-full" onClick={execute} disabled={busy}>
            <PlayCircle className="h-4 w-4" />
            {busy ? "Starting…" : "Execute agents"}
          </button>
          <p className="mt-3 text-xs muted">
            Mode: {WORKFLOW_SYNC ? "synchronous (serverless-safe)" : "background polling"}
          </p>
        </Card>

        <Card title="Execution history" description="Latest 15 runs" className="xl:col-span-3">
          {history.loading && !history.data ? <LoadingState /> : null}
          {history.error ? <ErrorState message={history.error} /> : null}
          {history.data && history.data.length === 0 ? (
            <EmptyState message="No executions yet — run the workflow or the demo scenario." />
          ) : null}
          {history.data?.length ? (
            <div className="-mx-5 max-h-56 overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Execution</th>
                    <th>Scenario</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th className="text-right">Transfers</th>
                    <th className="text-right">Orders</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((row) => {
                    const id = String(row.execution_id);
                    const summary = (row.summary || {}) as Record<string, unknown>;
                    return (
                      <tr key={id} className={executionId === id ? "bg-brand-50/50 dark:bg-brand-500/5" : ""}>
                        <td className="font-mono text-xs">{id.slice(0, 8)}…</td>
                        <td className="text-xs">{String(row.scenario)}</td>
                        <td>
                          <Badge value={String(row.status)} />
                        </td>
                        <td className="text-xs muted">{timeAgo(row.started_at as string)}</td>
                        <td className="text-right tabular-nums">{num(Number(summary.transfers ?? 0))}</td>
                        <td className="text-right tabular-nums">
                          {num(Number(summary.purchase_orders ?? 0))}
                        </td>
                        <td className="text-right">
                          <button
                            className="text-xs font-semibold text-brand-600"
                            onClick={() => setExecutionId(id)}
                          >
                            inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      {error ? <div className="mt-6"><ErrorState message={error} /></div> : null}

      {execution ? (
        <div className="mt-6 space-y-6">
          <Card
            title={`Execution ${execution.execution_id.slice(0, 8)}…`}
            description={`${execution.scenario} · started ${dateTime(execution.started_at)}`}
            actions={
              <div className="flex items-center gap-2">
                <Badge value={execution.status} />
                <span className="text-xs muted">{execution.progress}%</span>
              </div>
            }
          >
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className={`h-full rounded-full transition-all ${
                  execution.status === "failed" ? "bg-rose-500" : "bg-brand-600"
                }`}
                style={{ width: `${execution.progress}%` }}
              />
            </div>
            {execution.error ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {execution.error}
              </p>
            ) : null}

            <ol className="mt-5 space-y-3">
              {AGENTS.map((agent, index) => {
                const logs = logsByAgent.get(agent.key) ?? [];
                const done = completed.has(agent.key);
                const failed = logs.some((log) => log.status === "failed");
                const running = activeAgent === agent.key && !done && !failed;
                const last = logs[logs.length - 1];
                if (logs.length === 0 && !done) {
                  return (
                    <li key={agent.key} className="flex items-start gap-3 opacity-50">
                      <CircleDashed className="mt-0.5 h-4 w-4" />
                      <div>
                        <p className="text-sm font-medium">
                          {index + 1}. {agent.label}
                        </p>
                        <p className="text-xs muted">Not executed</p>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={agent.key} className="flex items-start gap-3">
                    {failed ? (
                      <XCircle className="mt-0.5 h-4 w-4 text-rose-500" />
                    ) : running ? (
                      <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-brand-500" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">
                          {index + 1}. {agent.label}
                        </p>
                        {last ? <Badge value={last.status} /> : null}
                        {last ? (
                          <span className="text-xs muted">{last.duration_ms} ms</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs muted">{last?.message}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          {execution.summary?.verification ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <Card title="Verification checks" description="Independent re-derivation of every constraint">
                <div className="flex items-center gap-2">
                  {execution.summary.verification.approved ? (
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-500" />
                  )}
                  <p className="text-sm font-medium">
                    {execution.summary.verification.approved ? "Approved" : "Rejected"}
                  </p>
                </div>
                <ul className="mt-4 space-y-3">
                  {execution.summary.verification.checks.map((check) => (
                    <li key={check.check} className="rounded-lg border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{check.check.replace(/_/g, " ")}</span>
                        <Badge value={check.passed ? "passed" : "failed"} kind="plain" />
                      </div>
                      <p className="mt-1 text-xs muted">{check.detail}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Decisions" description="Approved and rejected recommendations">
                {execution.summary.decisions?.length ? (
                  <div className="-mx-5 overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>SKU</th>
                          <th className="text-right">Qty</th>
                          <th>Approved</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {execution.summary.decisions.map((decision, index) => (
                          <tr key={`${decision.action}-${index}`}>
                            <td className="text-xs">{decision.action.replace(/_/g, " ")}</td>
                            <td className="font-medium">{decision.sku}</td>
                            <td className="text-right tabular-nums">{num(decision.quantity)}</td>
                            <td>
                              <Badge value={decision.approved ? "approved" : "rejected"} kind="plain" />
                            </td>
                            <td className="text-xs muted">{decision.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState message="No decisions were produced." />
                )}
                {execution.summary.recommended_actions?.length ? (
                  <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/60 p-3 text-xs dark:border-brand-500/30 dark:bg-brand-500/10">
                    <p className="font-semibold">Approved actions</p>
                    <p className="mt-1 muted">
                      {execution.summary.recommended_actions.join(" · ")}
                    </p>
                  </div>
                ) : null}
              </Card>
            </div>
          ) : null}

          <Card title="Raw agent log" description="Every persisted step, newest last">
            {execution.logs.length ? (
              <div className="-mx-5 max-h-96 overflow-y-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent</th>
                      <th>Status</th>
                      <th>Message</th>
                      <th className="text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execution.logs.map((log) => (
                      <tr key={log.id}>
                        <td className="tabular-nums text-xs">{log.step_index}</td>
                        <td className="text-xs font-medium">{log.agent_name}</td>
                        <td>
                          <Badge value={log.status} />
                        </td>
                        <td className="text-xs muted">{log.message}</td>
                        <td className="text-right text-xs tabular-nums">{log.duration_ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No log entries yet." />
            )}
          </Card>
        </div>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
