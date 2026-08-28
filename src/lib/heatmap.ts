/* ============================================================
   Heatmap 2D de liquidación (tiempo × precio) — estilo Coinglass
   Cada columna temporal es un mapa de liquidación estimado con
   las velas anteriores (ventana deslizante), sin mirar al futuro.
   ============================================================ */

import type { Candle } from "./engine";
import { liqDistance } from "./engine";

export interface HeatmapData {
  cols: number;
  bins: number;
  matrix: Float32Array; // cols * bins, fila 0 = precio máximo (arriba)
  closes: number[];
  times: number[]; // unix seconds por columna
  priceMin: number;
  priceMax: number;
}

export function buildHeatmap(
  candles: Candle[],
  leverages: number[],
  bins = 64,
  lookback = 24
): HeatmapData {
  const n = candles.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  const pad = (hi - lo) * 0.035 + hi * 0.002;
  const priceMin = lo - pad;
  const priceMax = hi + pad;
  const step = (priceMax - priceMin) / bins;
  const inv = 1 / step;

  const raw = new Float32Array(n * bins);

  const add = (arr: Float32Array, price: number, w: number) => {
    const idx = (priceMax - price) * inv;
    const i0 = Math.floor(idx);
    for (let o = -1; o <= 1; o++) {
      const b = i0 + o;
      if (b < 0 || b >= bins) continue;
      arr[b] += w * (o === 0 ? 1 : 0.42);
    }
  };

  const levWeight: Record<number, number> = { 10: 1, 25: 0.85, 50: 0.68, 100: 0.5 };
  const tmp = new Float32Array(bins);

  for (let i = 0; i < n; i++) {
    tmp.fill(0);
    const start = Math.max(0, i - lookback + 1);
    for (let j = start; j <= i; j++) {
      const c = candles[j];
      const recency = Math.exp(-(i - j) / (lookback * 0.55));
      const volW = Math.pow(c.quoteVolume, 0.35);
      const base = recency * volW;
      for (const L of leverages) {
        const d = liqDistance(L);
        const lw = levWeight[L] ?? 0.7;
        add(tmp, c.high * (1 - d), base * 0.9 * lw);
        add(tmp, c.close * (1 - d), base * 0.6 * lw);
        add(tmp, c.low * (1 + d), base * 0.9 * lw);
        add(tmp, c.close * (1 + d), base * 0.6 * lw);
      }
    }
    // suavizado vertical ligero
    const col = raw.subarray(i * bins, i * bins + bins);
    for (let b = 0; b < bins; b++) {
      const a = tmp[Math.max(0, b - 1)];
      const m = tmp[b];
      const c2 = tmp[Math.min(bins - 1, b + 1)];
      col[b] = (a + 2 * m + c2) / 4;
    }
  }

  // normalización global para color consistente
  let gmax = 1e-9;
  for (let k = 0; k < raw.length; k++) if (raw[k] > gmax) gmax = raw[k];
  const matrix = new Float32Array(raw.length);
  for (let k = 0; k < raw.length; k++) matrix[k] = raw[k] / gmax;

  return {
    cols: n,
    bins,
    matrix,
    closes: candles.map((c) => c.close),
    times: candles.map((c) => c.time),
    priceMin,
    priceMax,
  };
}

/* Color por celda: lado según la posición respecto al cierre de esa columna.
   Debajo → verdes (liq longs) · Encima → rojos (liq shorts) · brillo = intensidad */
export function heatColor(intensity: number, below: boolean): string {
  const t = Math.pow(Math.max(0, Math.min(1, intensity)), 0.62);
  if (t <= 0.015) return below ? "rgba(23,52,46,0.55)" : "rgba(58,26,36,0.55)";
  let r: number, g: number, b: number, a: number;
  if (below) {
    // teal oscuro → verde → verde-amarillo caliente
    r = Math.round(16 + t * t * 190);
    g = Math.round(58 + t * 190);
    b = Math.round(52 + t * 90);
    a = 0.28 + t * 0.72;
  } else {
    // granate → rojo → naranja-amarillo caliente
    r = Math.round(70 + t * 185);
    g = Math.round(22 + t * t * 150);
    b = Math.round(40 + t * 40);
    a = 0.28 + t * 0.72;
  }
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
