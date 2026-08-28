/* ============================================================
   Top-Trader Position Flow — ratio de posiciones de las cuentas
   grandes (NO es "whale positions": las APIs públicas no revelan
   la concentración real de ballenas; se declara así).
   Delta 24h y z-score sobre 72h para detectar extremos de crowded.
   ============================================================ */

import { safeNum } from "./dataTruth";

export interface PositionFlow {
  ratio: number; // actual
  delta24h: number; // ratio ahora − ratio hace 24h
  zscore: number; // del valor actual sobre 72h
  extreme: "long" | "short" | null; // |z| >= 1.5
  samples: number;
}

interface RatioPoint {
  timestamp: number;
  longShortRatio: string;
}

export async function fetchPositionFlow(): Promise<PositionFlow> {
  const res = await fetch(
    "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=72"
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as RatioPoint[];
  if (!Array.isArray(data) || data.length < 8) throw new Error("muestra insuficiente");
  const vals = data.map((d) => safeNum(d.longShortRatio, NaN)).filter(Number.isFinite);
  if (vals.length < 8) throw new Error("datos no numéricos");
  const ratio = vals[vals.length - 1];
  const delta24h = ratio - vals[Math.max(0, vals.length - 25)];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1e-9;
  const zscore = (ratio - mean) / sd;
  const extreme = zscore >= 1.5 ? "long" : zscore <= -1.5 ? "short" : null;
  return { ratio, delta24h, zscore, extreme, samples: vals.length };
}
