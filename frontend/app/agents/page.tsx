"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Loader2,
  PlayCircle,
  ShieldCheck,
  ShieldX,
  XCircle,
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
  Progress,
  StatRow,
  TableWrap,
  Toast,
} from "@/components/ui";
import { ApiError, WORKFLOW_SYNC, apiGet, apiPost } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { dateTime, duration, num, timeAgo } from "@/lib/format";
import type { AgentExecution, AgentLog } from "@/types";

const AGENTS = [
  { key: "demand_forecasting_agent", label: "Demand Forecasting Agent" },
  { key: "inventory_monitoring_agent", label: "Inventory Monitoring Agent" },
  { key: "inventory_optimization_agent", label: "Inventory Optimization Agent" },
  { key: "procurement_agent", label: "Procurement Agent" },
  { key: "supplier_disruption_agent", label: "Supplier Disruption Agent" },
  { key: "logistics_agent", label: "Logistics Agent" },
  { key: "decision_verification_agent", label: "Decision Verification Agent" },
];

type ExecutionRow = {
  execution_id: string;
  status: string;
  scenario: string;
  started_at: string | null;
  finished_at: string | null;
  summary: Record<string, unknown> | null;
};

function outputSummary(log: AgentLog | undefined): string | null {
  if (!log?.payload) return null;
  const parts: string[] = [];
  Object.entries(log.payload).forEach(([key, value]) => {
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.count === "number") {
        parts.push(`${record.count} ${key.replace(/_/g, " ")}`);
      } else if (Array.isArray(record.checks)) {
        parts.push(`${record.checks.length} verification checks`);
      }
    } else if (typeof value === "number" || typeof value === "string") {
      parts.push(`${key.replace(/_/g, " ")}: ${value}`);
    }
  });
  return parts.length ? parts.join(" · ") : null;
}

export default function AgentControlCenterPage() {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [scenario, setScenario] = useState("disruption_demo");
  const [horizon, setHorizon] = useState(14);
  const [serviceLevel, setServiceLevel] = useState(0.95);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const history = useApi<ExecutionRow[]>("/api/agents/executions?limit=15");

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
      if (!quiet) setError(err instanceof ApiError ? err.message : "Could not load that execution.");
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
            ? "Workflow completed — every agent wrote a persisted log row."
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
    const map = new Map<string, AgentLog[]>();
    for (const log of execution?.logs ?? []) {
      const list = map.get(log.agent_name) ?? [];
      list.push(log);
      map.set(log.agent_name, list);
    }
    return map;
  }, [execution]);

  const completedAgents = new Set(
    (execution?.logs ?? [])
      .filter((log) => log.status === "completed")
      .map((log) => log.agent_name),
  );

  const runningAgent = AGENTS.find(
    (agent) => !completedAgents.has(agent.key) && logsByAgent.has(agent.key),
  )?.key;

  const verification = execution?.summary?.verification ?? null;
  const requiresReview =
    execution?.status === "completed" && verification !== null && verification.approved === false;

  const currentAgentLabel = execution?.current_agent
    ? (AGENTS.find((agent) => agent.key === execution.current_agent)?.label ??
      execution.current_agent)
    : null;

  const totalDuration = (execution?.logs ?? []).reduce((sum, log) => sum + log.duration_ms, 0);
  const failedLogs = (execution?.logs ?? []).filter((log) => log.status === "failed").length;

  return (
    <>
      <PageHeader
        title="AI Agent Control Center"
        subtitle="LangGraph executes seven specialised agents over one shared state. Every step writes an agent_logs row; the verification agent re-derives each constraint before anything is approved."
        actions={
          <button className="btn-primary" onClick={execute} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {busy ? "Executing workflow…" : "Execute Workflow"}
          </button>
        }
      />

      {requiresReview ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#EEDDBB] bg-[#FBF6EA] px-4 py-3 text-[13px] text-[#8A5F1B]">
          <ShieldX className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Verification rejected at least one decision — this execution is marked{" "}
            <strong>requires review</strong>. Inspect the failed checks below before acting on the
            recommendations.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Executions"
          value={num(history.data?.length ?? 0)}
          hint="Latest 15 recorded runs"
          icon={<PlayCircle className="h-4 w-4" />}
        />
        <KpiCard
          label="Selected status"
          value={execution ? execution.status.replace(/_/g, " ") : "—"}
          hint={execution ? `${execution.progress}% of the graph traversed` : "No run selected"}
          tone={
            execution?.status === "failed"
              ? "danger"
              : requiresReview
                ? "warning"
                : execution
                  ? "success"
                  : "neutral"
          }
        />
        <KpiCard
          label="Agents completed"
          value={
            execution
              ? `${num(completedAgents.size)} / ${AGENTS.length}`
              : `0 / ${AGENTS.length}`
          }
          hint={`${num(failedLogs)} failed step(s)`}
        />
        <KpiCard
          label="Logged agent time"
          value={totalDuration ? duration(totalDuration) : "—"}
          hint="Sum of persisted step durations"
          icon={<Clock3 className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Workflow parameters" description="Applied to the next execution">
            <div className="space-y-4">
              <Field label="Scenario">
                <select className="field" value={scenario} onChange={(event) => setScenario(event.target.value)}>
                  <option value="disruption_demo">Disruption demo</option>
                  <option value="standard_workflow">Standard workflow</option>
                </select>
              </Field>
              <Field label="Forecast horizon">
                <select
                  className="field"
                  value={horizon}
                  onChange={(event) => setHorizon(Number(event.target.value))}
                >
                  {[7, 14, 30].map((value) => (
                    <option key={value} value={value}>
                      {value} days
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Service level">
                <select
                  className="field"
                  value={serviceLevel}
                  onChange={(event) => setServiceLevel(Number(event.target.value))}
                >
                  {[0.9, 0.95, 0.98].map((value) => (
                    <option key={value} value={value}>
                      {(value * 100).toFixed(0)}%
                    </option>
                  ))}
                </select>
              </Field>
              <p className="rounded-lg bg-[#FBFAF6] px-3 py-2 text-[11px] leading-relaxed text-stone">
                Mode: {WORKFLOW_SYNC ? "synchronous (serverless-safe)" : "background polling"}.
                Records come from the database, never from a UI animation.
              </p>
            </div>
          </Card>

          <Card title="Execution history" description="Latest 15 runs" bodyClassName="p-0">
            {history.loading && !history.data ? (
              <div className="p-5">
                <LoadingPanel rows={4} />
              </div>
            ) : null}
            {history.error ? (
              <div className="p-5">
                <ErrorPanel message={history.error} />
              </div>
            ) : null}
            {history.data && history.data.length === 0 ? (
              <div className="p-5">
                <EmptyPanel message="No executions yet. Run the workflow to record one." />
              </div>
            ) : null}
            <div className="max-h-[420px] overflow-y-auto">
              {history.data?.map((row) => (
                <button
                  key={row.execution_id}
                  type="button"
                  onClick={() => setExecutionId(row.execution_id)}
                  className={`flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition last:border-0 hover:bg-forest-50/60 ${
                    executionId === row.execution_id ? "bg-forest-50" : ""
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      row.status === "completed"
                        ? "bg-[#EDF4EF] text-[#2F6B4A]"
                        : row.status === "failed"
                          ? "bg-[#FBEDEC] text-[#A9443E]"
                          : "bg-[#FBF3E4] text-[#94651F]"
                    }`}
                  >
                    {row.status === "completed" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] text-ink">
                      {row.execution_id.slice(0, 8)}
                    </span>
                    <span className="block text-[11px] text-stone">
                      {row.scenario.replace(/_/g, " ")} · {timeAgo(row.started_at)}
                    </span>
                  </span>
                  <span className="text-[11px] text-stone">
                    {num(Number(row.summary?.purchase_orders ?? 0))} PO
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {error ? <ErrorPanel message={error} /> : null}
          {!execution ? (
            <Card title="Execution timeline" description="Select a run or execute the workflow">
              <EmptyPanel message="No execution selected. Every node below is populated from agent_logs rows, including durations and decision explanations." />
            </Card>
          ) : (
            <>
              <Card
                title="Execution timeline"
                description={`${execution.scenario.replace(/_/g, " ")} · started ${dateTime(
                  execution.started_at,
                )} · ${execution.execution_id.slice(0, 8)}`}
                actions={<Badge value={requiresReview ? "requires review" : execution.status} />}
                bodyClassName="p-0"
              >
                <div className="border-b border-line px-5 py-4">
                  <div className="mb-2 flex items-center justify-between text-[11px] text-stone">
                    <span>{currentAgentLabel ?? "Workflow idle"}</span>
                    <span>{execution.progress}%</span>
                  </div>
                  <Progress
                    value={execution.progress}
                    tone={execution.status === "failed" ? "danger" : "forest"}
                  />
                  {execution.error ? (
                    <p className="mt-3 rounded-lg border border-[#F0D8D6] bg-[#FCF3F2] px-3 py-2 text-[11px] leading-relaxed text-[#93433E]">
                      {execution.error}
                    </p>
                  ) : null}
                </div>

                <ol className="relative px-5 py-4">
                  <span className="absolute bottom-8 left-[35px] top-8 w-px bg-line" aria-hidden />
                  {AGENTS.map((agent, index) => {
                    const logs = logsByAgent.get(agent.key) ?? [];
                    const last = logs[logs.length - 1];
                    const done = completedAgents.has(agent.key);
                    const failed = logs.some((log) => log.status === "failed");
                    const running = runningAgent === agent.key && !done && !failed;
                    const isVerification = agent.key === "decision_verification_agent";
                    const pendingReview = isVerification && requiresReview;
                    const status = failed
                      ? "failed"
                      : pendingReview
                        ? "requires review"
                        : done
                          ? "completed"
                          : running
                            ? "running"
                            : "pending";
                    const open = expanded === agent.key;
                    const summary = outputSummary(last);

                    return (
                      <li key={agent.key} className="relative flex gap-4 pb-5 last:pb-0">
                        <span
                          className={`relative z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 bg-white ${
                            failed
                              ? "border-[#C65B55] text-[#A9443E]"
                              : pendingReview
                                ? "border-[#D89A39] text-[#94651F]"
                                : done
                                  ? "border-[#4C8763] text-[#2F6B4A]"
                                  : running
                                    ? "border-[#8FA9B8] text-[#41637A]"
                                    : "border-line text-stone"
                          }`}
                        >
                          {failed ? (
                            <XCircle className="h-3.5 w-3.5" />
                          ) : pendingReview ? (
                            <ShieldX className="h-3.5 w-3.5" />
                          ) : done ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : running ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CircleDashed className="h-3.5 w-3.5" />
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[13px] font-medium text-ink">
                              {index + 1}. {agent.label}
                            </p>
                            <Badge value={status} />
                            {last ? (
                              <span className="text-[11px] tabular-nums text-stone">
                                {duration(last.duration_ms)}
                              </span>
                            ) : null}
                          </div>

                          {last ? (
                            <div className="mt-1.5 space-y-1 text-[12px] leading-relaxed">
                              <p className="text-stone">
                                <span className="font-medium text-forest-700">Input </span>
                                {index === 0
                                  ? `Scenario ${execution.scenario.replace(/_/g, " ")}, ${
                                      execution.horizon_days ?? horizon
                                    }-day horizon`
                                  : `Shared state from ${AGENTS[index - 1].label}`}
                              </p>
                              <p className="text-ink">{last.message}</p>
                              {summary ? (
                                <p className="text-stone">
                                  <span className="font-medium text-forest-700">Output </span>
                                  {summary}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="mt-1 text-[12px] text-stone">Not executed in this run.</p>
                          )}

                          {last ? (
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : agent.key)}
                              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-forest-600 hover:text-forest-800"
                            >
                              {open ? "Hide decision record" : "Decision record"}
                              <ChevronDown
                                className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                              />
                            </button>
                          ) : null}

                          {open && last ? (
                            <div className="mt-2 space-y-2">
                              <dl className="rounded-lg bg-[#FBFAF6] px-3 py-2">
                                <StatRow label="Status" value={last.status} />
                                <StatRow label="Step index" value={String(last.step_index)} />
                                <StatRow label="Duration" value={duration(last.duration_ms)} />
                                <StatRow label="Logged at" value={dateTime(last.created_at)} />
                              </dl>
                              <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-white p-3 text-[10.5px] leading-relaxed text-[#3A423D]">
                                {JSON.stringify(last.payload ?? { message: last.message }, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>

              {verification ? (
                <div className="grid gap-6 xl:grid-cols-2">
                  <Card
                    title="Verification checks"
                    description="Independent re-derivation of every constraint"
                    actions={
                      <span
                        className={`flex items-center gap-1.5 text-[11px] font-medium ${
                          verification.approved ? "text-[#2F6B4A]" : "text-[#A9443E]"
                        }`}
                      >
                        {verification.approved ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : (
                          <ShieldX className="h-3.5 w-3.5" />
                        )}
                        {verification.approved ? "Approved" : "Rejected"}
                      </span>
                    }
                  >
                    <ul className="space-y-2.5">
                      {verification.checks.map((check) => (
                        <li
                          key={check.check}
                          className="rounded-xl border border-line px-3.5 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium capitalize text-ink">
                              {check.check.replace(/_/g, " ")}
                            </span>
                            <Badge value={check.passed ? "passed" : "failed"} />
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-stone">{check.detail}</p>
                        </li>
                      ))}
                    </ul>
                    {verification.summary ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-stone">
                        {verification.summary}
                      </p>
                    ) : null}
                  </Card>

                  <Card
                    title="Decisions"
                    description="Approved and rejected recommendations"
                    bodyClassName="pb-2"
                  >
                    {execution.summary?.decisions?.length ? (
                      <TableWrap>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>SKU</th>
                              <th className="text-right">Qty</th>
                              <th>Outcome</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {execution.summary.decisions.map((decision, index) => (
                              <tr key={`${decision.action}-${index}`}>
                                <td className="text-[12px] capitalize">
                                  {decision.action.replace(/_/g, " ")}
                                </td>
                                <td className="font-medium">{decision.sku}</td>
                                <td className="text-right tabular-nums">{num(decision.quantity)}</td>
                                <td>
                                  <Badge value={decision.approved ? "approved" : "rejected"} />
                                </td>
                                <td className="max-w-[220px] text-[11px] text-stone">
                                  {decision.reason}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableWrap>
                    ) : (
                      <EmptyPanel message="No decisions were produced by this run." />
                    )}
                    {execution.summary?.recommended_actions?.length ? (
                      <div className="mx-5 mb-3 rounded-lg bg-forest-50 px-3 py-2">
                        <p className="text-[11px] font-semibold text-forest-800">Approved actions</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-stone">
                          {execution.summary.recommended_actions.join(" · ")}
                        </p>
                      </div>
                    ) : null}
                  </Card>
                </div>
              ) : null}

              <Card
                title="Raw agent log"
                description="Every persisted step, oldest first"
                bodyClassName="pb-2"
              >
                {execution.logs.length ? (
                  <TableWrap>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>Agent</th>
                          <th>Status</th>
                          <th>Message</th>
                          <th className="text-right">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {execution.logs.map((log) => (
                          <tr key={log.id}>
                            <td className="tabular-nums text-[12px] text-stone">{log.step_index}</td>
                            <td className="text-[12px] font-medium">{log.agent_name}</td>
                            <td>
                              <Badge value={log.status} />
                            </td>
                            <td className="max-w-[520px] text-[11px] leading-relaxed text-stone">
                              {log.message}
                            </td>
                            <td className="text-right text-[12px] tabular-nums">
                              {duration(log.duration_ms)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                ) : (
                  <div className="p-5">
                    <EmptyPanel message="No log entries yet." />
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}
