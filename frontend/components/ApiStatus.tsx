"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

type Health = {
  status: string;
  database: { status: string; dialect: string };
};

export function ApiStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
        const body = (await response.json()) as Health;
        if (!cancelled) {
          setHealth(body);
          setFailed(!response.ok);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const ok = health?.status === "ok" && !failed;
  return (
    <div className="hidden items-center gap-2 rounded-full border px-3 py-1 text-xs sm:flex">
      <span
        className={`h-2 w-2 rounded-full ${
          failed ? "bg-rose-500" : ok ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      <span className="muted">
        {failed
          ? "API offline"
          : health
            ? `${health.database.dialect} · ${health.database.status}`
            : "Checking API"}
      </span>
    </div>
  );
}
