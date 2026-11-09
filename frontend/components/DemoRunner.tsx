"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Play, ReceiptText } from "lucide-react";
import { ApiError, apiPost } from "@/lib/api";
import type { AgentExecution } from "@/types";
import { Toast } from "@/components/ui";

/**
 * Executes the complete business scenario against real database rows:
 * forecast → monitor → optimize → procure → disrupt → transfer → verify.
 */
export function DemoRunner({
  compact = false,
  onFinished,
}: {
  compact?: boolean;
  onFinished?: (execution: AgentExecution) => void;
}) {
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setToast(null);
    try {
      const execution = await apiPost<AgentExecution>(
        "/api/agents/demo?wait_for_completion=true&horizon_days=14",
      );
      setExecutionId(execution.execution_id);
      setToast({
        message:
          execution.status === "completed"
            ? `Scenario complete · ${execution.summary?.transfers ?? 0} transfer(s), ${
                execution.summary?.purchase_orders ?? 0
              } purchase order(s), ${execution.summary?.active_disruptions ?? 0} disruption(s).`
            : `Execution finished with status ${execution.status}.`,
        tone: execution.status === "completed" ? "success" : "error",
      });
      onFinished?.(execution);
    } catch (error) {
      setToast({
        message: error instanceof ApiError ? error.message : "Could not run the scenario.",
        tone: "error",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "flex flex-wrap items-center gap-2"}>
      <button type="button" className="btn-primary" onClick={run} disabled={running}>
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {running ? "Running 7 agents…" : "Run demonstration scenario"}
      </button>
      {executionId ? (
        <Link href={`/agents?execution=${executionId}`} className="btn-outline">
          <ReceiptText className="h-4 w-4" /> View timeline
        </Link>
      ) : null}
      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}
