/* ============================================================
   Niveles clave y estructura — niveles objetivos derivados de
   las velas (sin estimación): apertura diaria/semanal, máx/mín
   del día anterior, rango visible, Fibonacci y pivotes clásicos.
   ============================================================ */

import type { Candle } from "./engine";

export type LevelKind = "resistencia" | "soporte" | "neutro";

export interface KeyLevel {
  price: number;
  label: string;
  short: string;
  kind: LevelKind; // relativo al spot actual
  group: "estructura" | "fib" | "pivote";
  distancePct: number; // (price − spot)/spot ×100
}

const FIBS = [
  { r: 0.236, s: "23.6" },
  { r: 0.382, s: "38.2" },
  { r: 0.5, s: "50.0" },
  { r: 0.618, s: "61.8" },
  { r: 0.786, s: "78.6" },
];

/** día UTC de la semana: 0=domingo … 6=sábado (getUTCDay) */
export function computeKeyLevels(daily: Candle[], visible: Candle[], spot: number): KeyLevel[] {
  if (!Number.isFinite(spot) || spot <= 0) return [];
  const out: { price: number; label: string; short: string; group: KeyLevel["group"] }[] = [];
  const dist = (p: number) => ((p - spot) / spot) * 100;

  /* --- estructura diaria/semanal (de velas 1d) --- */
  if (daily.length >= 2) {
    const prev = daily[daily.length - 2]; // día anterior cerrado
    const today = daily[daily.length - 1]; // día en curso
    out.push({ price: prev.high, label: "Máximo día anterior", short: "PDH", group: "estructura" });
    out.push({ price: prev.low, label: "Mínimo día anterior", short: "PDL", group: "estructura" });
    out.push({ price: today.open, label: "Apertura diaria (00:00 UTC)", short: "DO", group: "estructura" });

    // apertura semanal: vela del lunes (getUTCDay === 1) más reciente
    let monday: Candle | null = null;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (new Date(daily[i].time * 1000).getUTCDay() === 1) {
        monday = daily[i];
        break;
      }
    }
    if (monday) out.push({ price: monday.open, label: "Apertura semanal (lunes)", short: "WO", group: "estructura" });
  }

  /* --- rango visible + Fibonacci --- */
  if (visible.length >= 2) {
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of visible) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    out.push({ price: hi, label: "Máximo del rango visible", short: "RH", group: "estructura" });
    out.push({ price: lo, label: "Mínimo del rango visible", short: "RL", group: "estructura" });
    for (const f of FIBS) {
      const p = hi - (hi - lo) * f.r; // retroceso desde el máximo
      out.push({ price: p, label: `Fibonacci ${f.s}%`, short: `F${f.s}`, group: "fib" });
    }
  }

  /* --- pivotes clásicos del día anterior --- */
  if (daily.length >= 2) {
    const prev = daily[daily.length - 2];
    const P = (prev.high + prev.low + prev.close) / 3;
    out.push({ price: P, label: "Pivote diario", short: "P", group: "pivote" });
    out.push({ price: 2 * P - prev.low, label: "Resistencia 1", short: "R1", group: "pivote" });
    out.push({ price: P + (prev.high - prev.low), label: "Resistencia 2", short: "R2", group: "pivote" });
    out.push({ price: 2 * P - prev.high, label: "Soporte 1", short: "S1", group: "pivote" });
    out.push({ price: P - (prev.high - prev.low), label: "Soporte 2", short: "S2", group: "pivote" });
  }

  // dedup por precio cercano y clasifica contra el spot
  const seen = new Map<number, KeyLevel>();
  for (const l of out) {
    if (!Number.isFinite(l.price) || l.price <= 0) continue;
    const key = Math.round(l.price / (spot * 0.0004)); // agrupa niveles a <0.04%
    if (seen.has(key)) continue;
    const kind: LevelKind = Math.abs(l.price - spot) / spot < 0.0015 ? "neutro" : l.price > spot ? "resistencia" : "soporte";
    seen.set(key, { ...l, kind, distancePct: dist(l.price) });
  }
  return Array.from(seen.values()).sort((a, b) => b.price - a.price);
}

export const KIND_COLOR: Record<LevelKind, string> = {
  resistencia: "#ff4d6d",
  soporte: "#2fd6a5",
  neutro: "#93a5c8",
};
