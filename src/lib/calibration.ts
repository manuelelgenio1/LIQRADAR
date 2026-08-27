/* ============================================================
   Auto-calibración del motor
   Convierte el scorecard del laboratorio (FactorStat[]) en un
   nuevo juego de pesos: los factores que históricamente aciertan
   ganan influencia, los que fallan la pierden. Todo se normaliza
   a suma 1 y se persiste en el navegador.
   ============================================================ */

import type { FactorStat } from "./backtest";

/** Pesos base del motor (deben reflejar engine.ts) */
export const BASE_WEIGHTS: Record<string, number> = {
  funding: 0.11,
  fundingTrend: 0.06,
  global: 0.08,
  top: 0.09,
  pools: 0.16,
  oi: 0.07,
  oiSlope: 0.07,
  taker: 0.07,
  live: 0.06,
  cvd: 0.06,
  premium: 0.05,
  mtf: 0.06,
  momentum: 0.06,
};

export interface Calibration {
  weights: Record<string, number>;
  savedAt: number; // ms
  samples: number; // señales usadas
  horizonH: number;
  sim: boolean;
}

const KEY = "liqradar-calibration-v1";
const MIN_SAMPLES = 8; // por debajo de esto no hay evidencia suficiente → se conserva el peso base

/** hitRate ∈ [0,1] → multiplicador acotado [0.4, 1.8] */
const multiplier = (hitRate: number) => Math.min(1.8, Math.max(0.4, 0.5 + hitRate));

export function calibrateWeights(stats: FactorStat[]): Record<string, number> {
  const raw: Record<string, number> = { ...BASE_WEIGHTS };
  for (const s of stats) {
    const base = BASE_WEIGHTS[s.id];
    if (base === undefined) continue;
    const evidence = s.agreed; // veces que apoyó la dirección final
    if (evidence < MIN_SAMPLES) continue; // sin muestra suficiente, no tocar
    const hitRate = s.agreedCorrect / evidence;
    raw[s.id] = base * multiplier(hitRate);
  }
  // normalizar a suma 1
  const sum = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw)) out[k] = raw[k] / sum;
  return out;
}

export function saveCalibration(c: Calibration) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* noop */
  }
}

export function loadCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Calibration;
    if (!c || !c.weights) return null;
    return c;
  } catch {
    return null;
  }
}

export function clearCalibration() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** Tasa de acierto global persistida por el laboratorio (para el índice de confiabilidad) */
const HIT_KEY = "liqradar-hitrate-v1";

export function saveHitRate(hitRate: number, samples: number) {
  try {
    localStorage.setItem(HIT_KEY, JSON.stringify({ hitRate, samples, at: Date.now() }));
  } catch {
    /* noop */
  }
}

export function loadHitRate(): { hitRate: number; samples: number; at: number } | null {
  try {
    const raw = localStorage.getItem(HIT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { hitRate: number; samples: number; at: number };
    if (typeof o.hitRate !== "number") return null;
    return o;
  } catch {
    return null;
  }
}
