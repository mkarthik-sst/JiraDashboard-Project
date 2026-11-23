"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry } from "@/lib/types";
import { api, type DashState } from "./types";

/** Polls /api/state every 2 seconds (swap for EventSource if you prefer SSE). Accumulates the log stream. */
export function useDashboard(intervalMs = 2000) {
  const [state, setState] = useState<DashState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [offline, setOffline] = useState("");
  const since = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const s = await api<DashState>(`/api/state?since=${since.current}`);
      since.current = s.lastSeq;
      if (s.logs.length) setLogs((prev) => [...prev, ...s.logs].slice(-600));
      setState(s); setOffline("");
    } catch (e) { setOffline((e as Error).message); }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { state, logs, offline, refresh };
}
