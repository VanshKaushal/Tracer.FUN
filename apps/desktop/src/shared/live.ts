import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call, localBrowser, nativeDesktop } from "../api";
import type { LiveStats } from "../types";
export function useLiveStats() {
  const [live, setLive] = useState<LiveStats | null>(null);
  const [unavailable, setUnavailable] = useState("");
  useEffect(() => {
    if (localBrowser) {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout>;
      let attempts = 0;
      const poll = async () => {
        try {
          const value = await call<LiveStats>("GetLiveStats");
          if (!disposed) {
            setLive(value);
            setUnavailable("");
          }
          attempts = 0;
        } catch (e) {
          if (!disposed) setUnavailable(String(e));
          attempts++;
        }
        if (!disposed)
          timer = setTimeout(
            () => void poll(),
            [1000, 2000, 5000, 10000, 30000][Math.min(attempts, 4)],
          );
      };
      void poll();
      return () => {
        disposed = true;
        clearTimeout(timer);
      };
    }
    if (!nativeDesktop) return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const accept = (value: LiveStats) => {
      if (!disposed) {
        setLive((previous) =>
          !previous || value.timestamp_ms >= previous.timestamp_ms
            ? value
            : previous,
        );
        setUnavailable("");
      }
    };
    void listen<LiveStats>("trace-live", (e) => accept(e.payload))
      .then((fn) => (disposed ? fn() : cleanup.push(fn)))
      .catch(() => {});
    void listen<string>("trace-unavailable", (e) => {
      if (!disposed) setUnavailable(e.payload);
    })
      .then((fn) => (disposed ? fn() : cleanup.push(fn)))
      .catch(() => {});
    void call<LiveStats>("GetLiveStats")
      .then(accept)
      .catch(() => {});
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);
  return { live, unavailable };
}
export function useClock(running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
export function timerText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
