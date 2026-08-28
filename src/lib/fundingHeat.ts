import type { FundingPoint } from "./exchanges";

/* ============================================================
   Lógica del heatmap de funding por exchange.
   Alinea los settlements (cada 8h) de Binance / OKX / Bybit y
   pinta cada celda según la tasa: verde = shorts pagan,
   rojo = longs pagan. Cuanto más intenso, más multitud apilada.
   ============================================================ */

export interface FundingCell {
  time: number;
  rate: number;
}

export interface FundingRow {
  exchange: "binance" | "okx" | "bybit";
  label: string;
  color: string;
  cells: FundingCell[];
  ok: boolean;
}

export interface FundingHeatData {
  rows: FundingRow[];
  cols: number;
  maxAbs: number; // para normalizar la intensidad de color
  sim: boolean;
}

const EXCHANGES: { id: "binance" | "okx" | "bybit"; label: string; color: string }[] = [
  { id: "binance", label: "BINANCE", color: "#ffb547" },
  { id: "okx", label: "OKX", color: "#e9f1ff" },
  { id: "bybit", label: "BYBIT", color: "#3fb6ff" },
];

/** Alinea por índice desde el más reciente y recorta a `cols` columnas */
export function buildFundingHeat(
  series: Record<"binance" | "okx" | "bybit", FundingPoint[]>,
  sim: boolean,
  cols = 24
): FundingHeatData {
  const lengths = EXCHANGES.map((e) => series[e.id].length).filter((n) => n > 0);
  const n = lengths.length > 0 ? Math.min(...lengths, cols) : 0;

  let maxAbs = 0.0001;
  const rows: FundingRow[] = EXCHANGES.map((e) => {
    const pts = series[e.id];
    const cells: FundingCell[] = [];
    if (n > 0) {
      // alinear desde el final (los más recientes)
      const slice = pts.slice(pts.length - n);
      for (const p of slice) {
        cells.push({ time: p.time, rate: p.rate });
        maxAbs = Math.max(maxAbs, Math.abs(p.rate));
      }
    }
    return { exchange: e.id, label: e.label, color: e.color, cells, ok: cells.length > 0 };
  });

  return { rows, cols: n, maxAbs, sim };
}

/** Escala de color: verde (shorts pagan) → neutro → rojo (longs pagan) */
export function rateColor(rate: number, maxAbs: number): string {
  const base = 0.0001; // funding "neutro" de referencia
  const t = Math.max(-1, Math.min(1, (rate - base) / Math.max(maxAbs - base, 0.00005)));
  // t < 0 → verde, t > 0 → rojo
  const a = 0.18 + 0.72 * Math.abs(t); // opacidad según intensidad
  if (t >= 0) {
    return `rgba(255,77,109,${a.toFixed(2)})`;
  }
  return `rgba(47,214,165,${a.toFixed(2)})`;
}

/** Quién paga en cada celda */
export function payer(rate: number): string {
  if (rate > 0.00012) return "longs pagan";
  if (rate < 0.00008) return "shorts pagan";
  return "equilibrado";
}

export function fmtRate(rate: number): string {
  return (rate * 100).toFixed(4) + "%";
}

/* Simulador coherente para cuando no hay red */
export function simFunding(cols: number, exchangeSeed: number): FundingPoint[] {
  const now = Date.now();
  const pts: FundingPoint[] = [];
  let rate = 0.0001;
  for (let i = cols - 1; i >= 0; i--) {
    rate += (Math.sin(i * 0.7 + exchangeSeed) * 0.5 + (Math.random() - 0.5)) * 0.00006;
    rate = Math.max(-0.0004, Math.min(0.0007, rate));
    pts.push({ time: now - i * 8 * 3600_000, rate });
  }
  return pts;
}
