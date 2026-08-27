import { useCallback, useEffect, useRef, useState } from "react";
import { biasFromCandles, confluenceGrade, type TfBias } from "../lib/engine";
import { fetchKlines } from "../lib/binance";

/* ============================================================
   Hook de confluencia multi-timeframe: descarga 12h, 24h y 72h,
   corre el motor en cada uno y devuelve los sesgos + el grado de
   acuerdo. Se usa tanto para pintar el panel como para ajustar el
   índice de confiabilidad de la señal principal.

   Robustez: usa Promise.allSettled → cada timeframe es
   independiente. Si uno falla (rate-limit / red), los demás siguen
   mostrando datos reales en vez de tirar todo a neutro.
   ============================================================ */

const TFS = [
  { tf: "12h", label: "12 HORAS", interval: "15m", limit: 48, ms: 900_000, range: 0.022, desc: "intradía · scalp" },
  { tf: "24h", label: "24 HORAS", interval: "30m", limit: 48, ms: 1_800_000, range: 0.035, desc: "swing · día" },
  { tf: "72h", label: "72 HORAS", interval: "1h", limit: 72, ms: 3_600_000, range: 0.062, desc: "posición · tendencia" },
];

export { TFS as CONFLUENCE_TFS };

export interface TfStatus {
  candles: number; // velas reales descargadas (0 si falló)
  ok: boolean;
}

export interface ConfluenceState {
  biases: TfBias[];
  tfStatus: Record<string, TfStatus>;
  loading: boolean;
  sim: boolean; // true solo si TODOS los TF fallaron
  anyLive: boolean; // true si al menos un TF tiene datos reales
  grade: number; // 0..100 de acuerdo
  gradeLabel: string;
  alignedDir: "up" | "down" | "mixed" | null;
  lastUpdated: number; // epoch ms de la última actualización (0 = nunca)
  refresh: () => void;
}

export function useConfluence(): ConfluenceState {
  const [biases, setBiases] = useState<TfBias[]>([]);
  const [tfStatus, setTfStatus] = useState<Record<string, TfStatus>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(0);
  const aliveRef = useRef(true);

  const run = useCallback(async () => {
    setLoading(true);
    // Cada timeframe por separado: un fallo no arrastra a los demás.
    const settled = await Promise.allSettled(
      TFS.map(async (t) => {
        const candles = await fetchKlines(t.interval, t.limit);
        if (candles.length === 0) throw new Error("sin velas");
        const bias = biasFromCandles(candles, t.tf, t.label, t.ms, t.range);
        return { bias, candles: candles.length };
      })
    );

    if (!aliveRef.current) return;

    const newBiases: TfBias[] = [];
    const newStatus: Record<string, TfStatus> = {};
    settled.forEach((res, i) => {
      const t = TFS[i];
      if (res.status === "fulfilled") {
        newBiases.push(res.value.bias);
        newStatus[t.tf] = { candles: res.value.candles, ok: true };
      } else {
        newBiases.push({ tf: t.tf, label: t.label, direction: "neutral", scorePct: 0, word: "NEUTRO" });
        newStatus[t.tf] = { candles: 0, ok: false };
      }
    });

    setBiases(newBiases);
    setTfStatus(newStatus);
    setLastUpdated(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    run();
    const id = setInterval(run, 90_000);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [run]);

  const { grade, label, alignedDir } = confluenceGrade(biases);
  const anyLive = biases.some((b) => tfStatus[b.tf]?.ok);
  const sim = biases.length > 0 && !anyLive;

  return { biases, tfStatus, loading, sim, anyLive, grade, gradeLabel: label, alignedDir, lastUpdated, refresh: run };
}
