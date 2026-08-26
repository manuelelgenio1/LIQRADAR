/* ============================================================
   Track record del modelo: registra cada veredicto con sesgo y
   lo evalúa contra el precio real (objetivo vs invalidación)
   ============================================================ */

import type { Verdict } from "./engine";

export type PredStatus = "abierta" | "acierto" | "fallo" | "caducada";

export interface Prediction {
  id: string;
  time: number;
  direction: "up" | "down";
  headline: string;
  spot: number;
  target: number | null;
  invalidation: number | null;
  scorePct: number;
  confidence: number;
  windowH: [number, number];
  status: PredStatus;
  resolvedAt?: number;
  note?: string;
}

const KEY = "liqradar-preds-v2";
const MAX_STORED = 40;

export function loadPredictions(): Prediction[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Prediction[];
    return Array.isArray(list) ? list.slice(0, MAX_STORED) : [];
  } catch {
    return [];
  }
}

export function savePredictions(list: Prediction[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_STORED)));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function evaluatePredictions(list: Prediction[], spot: number, now: number): { list: Prediction[]; changed: boolean } {
  let changed = false;
  const out = list.map((p) => {
    if (p.status !== "abierta") return p;
    const ageH = (now - p.time) / 3600_000;

    if (p.direction === "up") {
      if (p.target !== null && spot >= p.target) {
        changed = true;
        return { ...p, status: "acierto" as const, resolvedAt: now, note: "Objetivo de shorts alcanzado" };
      }
      if (p.invalidation !== null && spot <= p.invalidation) {
        changed = true;
        return { ...p, status: "fallo" as const, resolvedAt: now, note: "Invalidación barrida antes" };
      }
    } else {
      if (p.target !== null && spot <= p.target) {
        changed = true;
        return { ...p, status: "acierto" as const, resolvedAt: now, note: "Objetivo de longs alcanzado" };
      }
      if (p.invalidation !== null && spot >= p.invalidation) {
        changed = true;
        return { ...p, status: "fallo" as const, resolvedAt: now, note: "Invalidación barrida antes" };
      }
    }
    if (ageH > Math.max(24, p.windowH[1] * 1.5)) {
      changed = true;
      return { ...p, status: "caducada" as const, resolvedAt: now, note: "Ventana superada sin resolución" };
    }
    return p;
  });
  return { list: out, changed };
}

/** ¿Vale la pena registrar este veredicto? Evita duplicados por el mismo escenario. */
export function shouldRecord(v: Verdict, spot: number, last: Prediction | null, now: number): boolean {
  if (v.direction === "neutral" || !v.target) return false;
  const key = `${v.direction}:${Math.round(v.target.price / 200)}`;
  if (!last) return true;
  const lastKey = `${last.direction}:${last.target !== null ? Math.round(last.target / 200) : ""}`;
  if (key !== lastKey) return now - last.time > 4 * 60_000; // cambio de escenario: mínimo 4 min
  return now - last.time > 20 * 60_000; // mismo escenario: refrescar cada 20 min
}

export function toPrediction(v: Verdict, spot: number, now: number): Prediction {
  return {
    id: `p-${now}-${Math.floor(Math.random() * 1e6)}`,
    time: now,
    direction: v.direction as "up" | "down",
    headline: v.headline,
    spot,
    target: v.target?.price ?? null,
    invalidation: v.invalidation?.price ?? null,
    scorePct: v.scorePct,
    confidence: v.confidence,
    windowH: v.windowH,
    status: "abierta",
  };
}

export interface TrackStats {
  hits: number;
  misses: number;
  open: number;
  expired: number;
  hitRate: number | null; // null = sin datos cerrados
  avgConfOnHit: number | null;
}

export function trackStats(list: Prediction[]): TrackStats {
  const hits = list.filter((p) => p.status === "acierto").length;
  const misses = list.filter((p) => p.status === "fallo").length;
  const open = list.filter((p) => p.status === "abierta").length;
  const expired = list.filter((p) => p.status === "caducada").length;
  const closed = hits + misses;
  const hitList = list.filter((p) => p.status === "acierto");
  return {
    hits,
    misses,
    open,
    expired,
    hitRate: closed > 0 ? (hits / closed) * 100 : null,
    avgConfOnHit: hitList.length > 0 ? hitList.reduce((a, p) => a + p.confidence, 0) / hitList.length : null,
  };
}
