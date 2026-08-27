import { useEffect, useState } from "react";
import { biasFromCandles, confluenceGrade, type TfBias } from "../lib/engine";
import { fetchKlines } from "../lib/binance";

/* ============================================================
   Hook de confluencia multi-timeframe: descarga 12h, 24h y 72h,
   corre el motor en cada uno y devuelve los sesgos + el grado de
   acuerdo. Se usa tanto para pintar el panel como para ajustar el
   índice de confiabilidad de la señal principal.
   ============================================================ */

const TFS = [
  { tf: "12h", label: "12 HORAS", interval: "15m", limit: 48, ms: 900_000, range: 0.022, desc: "intradía · scalp" },
  { tf: "24h", label: "24 HORAS", interval: "30m", limit: 48, ms: 1_800_000, range: 0.035, desc: "swing · día" },
  { tf: "72h", label: "72 HORAS", interval: "1h", limit: 72, ms: 3_600_000, range: 0.062, desc: "posición · tendencia" },
];

export { TFS as CONFLUENCE_TFS };

export interface ConfluenceState {
  biases: TfBias[];
  loading: boolean;
  sim: boolean;
  grade: number; // 0..100 de acuerdo
  gradeLabel: string;
  alignedDir: "up" | "down" | "mixed" | null;
}

export function useConfluence(): ConfluenceState {
  const [biases, setBiases] = useState<TfBias[]>([]);
  const [loading, setLoading] = useState(true);
  const [sim, setSim] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          TFS.map(async (t) => {
            const candles = await fetchKlines(t.interval, t.limit);
            return biasFromCandles(candles, t.tf, t.label, t.ms, t.range);
          })
        );
        if (alive) {
          setBiases(results);
          setSim(false);
        }
      } catch {
        if (alive) {
          setBiases(TFS.map((t) => ({ tf: t.tf, label: t.label, direction: "neutral" as const, scorePct: 0, word: "NEUTRO" })));
          setSim(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    const id = setInterval(run, 90_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const { grade, label, alignedDir } = confluenceGrade(biases);

  return { biases, loading, sim, grade, gradeLabel: label, alignedDir };
}
