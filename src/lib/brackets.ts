/* ============================================================
   Brackets de margen (MMR por tier) de BTCUSDT.
   - Sin servidor local: se usa la tabla DOCUMENTADA de Binance
     (pública) → calidad ESTIMADA.
   - Con servidor local (server.mjs + .env con key solo-lectura):
     se consultan los brackets REALES del usuario → calidad REAL.
   Nunca se embebe una API key en el frontend.
   ============================================================ */

import { markSource } from "./dataTruth";

export interface Bracket {
  ceiling: number; // notional máximo del tier (USDT)
  mmr: number; // maintenance margin rate (fracción)
  maxLeverage: number;
}

/* Tabla pública documentada de Binance para BTCUSDT (USDT-M, tier 1-3) */
export const DOCUMENTED_BRACKETS: Bracket[] = [
  { ceiling: 50_000, mmr: 0.004, maxLeverage: 125 },
  { ceiling: 250_000, mmr: 0.005, maxLeverage: 100 },
  { ceiling: 1_000_000, mmr: 0.01, maxLeverage: 50 },
];

/* MMR estimado por apalancamiento (asume posición retail = tier 1, sube de tier
   para apalancamientos bajos que admiten posiciones grandes) */
const MMR_BY_LEV: Record<number, number> = {
  10: 0.01, // tier 3
  25: 0.005, // tier 2
  50: 0.005, // tier 2
  100: 0.004, // tier 1
};

export function mmrForLeverage(L: number): number {
  return MMR_BY_LEV[L] ?? 0.004;
}

export interface BracketsState {
  brackets: Bracket[];
  source: "real" | "documented";
}

let cached: BracketsState | null = null;
let tried = false;

/** Intenta los brackets reales vía proxy local; si no, usa los documentados */
export async function getBrackets(): Promise<BracketsState> {
  if (cached) return cached;
  if (!tried) {
    tried = true;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch("http://127.0.0.1:4173/api/leverageBracket", { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const j = (await res.json()) as { brackets?: Bracket[] };
        if (Array.isArray(j.brackets) && j.brackets.length > 0) {
          cached = { brackets: j.brackets, source: "real" };
          markSource("brackets", "real", "leverageBracket firmado vía proxy local");
          return cached;
        }
      }
    } catch {
      /* sin proxy → documentados */
    }
  }
  cached = { brackets: DOCUMENTED_BRACKETS, source: "documented" };
  markSource("brackets", "estimated", "tabla pública documentada (sin proxy local)");
  return cached;
}
