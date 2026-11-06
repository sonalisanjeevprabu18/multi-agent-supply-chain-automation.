"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useApi<T>(path: string | null, refreshMs = 0) {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: Boolean(path),
  });
  const mounted = useRef(true);

  const load = useCallback(
    async (silent = false) => {
      if (!path) {
        setState({ data: null, error: null, loading: false });
        return;
      }
      if (!silent) setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await apiGet<T>(path);
        if (mounted.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!mounted.current) return;
        const message =
          error instanceof ApiError ? error.message : "Unexpected error loading data.";
        setState({ data: null, error: message, loading: false });
      }
    },
    [path],
  );

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !path) return;
    const interval = setInterval(() => load(true), refreshMs);
    return () => clearInterval(interval);
  }, [refreshMs, path, load]);

  return { ...state, reload: load };
}
