import { useCallback, useEffect, useState } from "react";
import { fetchOptionsSentiment, type OptionsSentiment } from "../lib/options";
import { logAudit } from "../lib/auditLog";

/* ============================================================
   Sentimiento de opciones: consulta el put/call ratio cada 5 min.
   Si Binance Options no está disponible (red / región), el valor
   queda en null y el factor del motor permanece neutro.
   ============================================================ */

export interface OptionsState {
  data: OptionsSentiment | null;
  loading: boolean;
  lastUpdated: number;
  unavailable: boolean; // true si ya intentamos y falló
}

const INTERVAL = 5 * 60_000;

export function useOptionsSentiment(): OptionsState & { refresh: () => void } {
  const [data, setData] = useState<OptionsSentiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  const run = useCallback(async () => {
    try {
      const d = await fetchOptionsSentiment();
      if (d) {
        setData(d);
        setUnavailable(false);
        setLastUpdated(Date.now());
      } else {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await run();
      if (unavailable) logAudit("datos", "warn", "Opciones de Binance no disponibles — factor put/call en neutro");
    })();
    const id = setInterval(() => {
      if (alive) void run();
    }, INTERVAL);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, lastUpdated, unavailable, refresh: () => void run() };
}
