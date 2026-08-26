/* ============================================================
   Laboratorio de validación — backtest walk-forward
   Re-ejecuta el MISMO motor sobre velas históricas y comprueba
   cada señal hacia adelante (nunca mira datos futuros).
   ============================================================ */

import type { Candle, Verdict } from "./engine";
import { atrOf, computeCvd, estimateLiquidationMap, computeVerdict } from "./engine";

export interface BtTest {
  time: number; // unix s (momento de la señal)
  dir: "up" | "down";
  headline: string;
  spot: number;
  target: number | null;
  inval: number | null;
  confidence: number;
  outcome: "acierto" | "fallo" | "caducada";
  pnlPct: number; // resultado si sigues la señal (en %)
  hoursToResolve: number;
}

export interface BtBucket {
  label: string;
  hits: number;
  closed: number;
}

export interface BtResult {
  tests: BtTest[];
  hits: number;
  misses: number;
  expired: number;
  neutralSkipped: number;
  closed: number;
  hitRate: number | null; // % sobre cerradas
  edgePct: number | null; // vs azar (50%)
  expectancyPct: number; // pnl medio por señal (todas)
  byDir: { up: BtBucket; down: BtBucket };
  byBucket: BtBucket[];
  equity: number[]; // curva acumulada en %
  candlesUsed: number;
  windowSize: number;
  horizonH: number;
  sim: boolean;
}

const LEVERAGES = [10, 25, 50, 100];
const WINDOW = 72; // velas de contexto (72 × 1h)
const STRIDE = 4; // nueva prueba cada 4 velas
const RANGE_PCT = 0.062;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slopesOf(candles: Candle[]): { fast: number; slow: number } {
  const n = candles.length;
  if (n < 4) return { fast: 0, slow: 0 };
  const last = candles[n - 1].close;
  const k = Math.max(2, Math.floor(n / 3));
  const fast = ((last - candles[n - 1 - k].close) / candles[n - 1 - k].close) * 100;
  const slow = ((last - candles[0].close) / candles[0].close) * 100;
  return { fast, slow };
}

/** Evalúa una señal contra las velas siguientes (sin lookahead) */
function resolveSignal(
  v: Verdict,
  spot: number,
  candles: Candle[],
  start: number,
  horizonCandles: number,
  msPerCandle: number
): { outcome: BtTest["outcome"]; pnlPct: number; hours: number } {
  const target = v.target?.price ?? null;
  const inval = v.invalidation?.price ?? null;
  const up = v.direction === "up";
  const end = Math.min(candles.length, start + horizonCandles);

  for (let j = start; j < end; j++) {
    const c = candles[j];
    const hitT = target !== null && (up ? c.high >= target : c.low <= target);
    const hitI = inval !== null && (up ? c.low <= inval : c.high >= inval);
    if (hitT && hitI) {
      // ambos niveles dentro de la misma vela → decide cuál estaba más cerca del open
      const dT = Math.abs(c.open - (target as number));
      const dI = Math.abs(c.open - (inval as number));
      if (dT <= dI) {
        return { outcome: "acierto", pnlPct: (Math.abs((target as number) - spot) / spot) * 100, hours: ((j - start + 1) * msPerCandle) / 3600_000 };
      }
      return { outcome: "fallo", pnlPct: -(Math.abs(((inval as number) - spot) / spot) * 100), hours: ((j - start + 1) * msPerCandle) / 3600_000 };
    }
    if (hitT) {
      return { outcome: "acierto", pnlPct: (Math.abs((target as number) - spot) / spot) * 100, hours: ((j - start + 1) * msPerCandle) / 3600_000 };
    }
    if (hitI) {
      return { outcome: "fallo", pnlPct: -(Math.abs(((inval as number) - spot) / spot) * 100), hours: ((j - start + 1) * msPerCandle) / 3600_000 };
    }
  }

  // horizonte agotado → resultado con el movimiento real
  const finalClose = candles[Math.min(end, candles.length) - 1].close;
  const move = ((finalClose - spot) / spot) * 100 * (up ? 1 : -1);
  return { outcome: "caducada", pnlPct: move, hours: ((end - start) * msPerCandle) / 3600_000 };
}

export async function runWalkForward(
  candles: Candle[],
  msPerCandle: number,
  horizonH: number,
  sim: boolean,
  onProgress: (pct: number) => void
): Promise<BtResult> {
  const horizonCandles = Math.max(1, Math.round((horizonH * 3600_000) / msPerCandle));
  const tests: BtTest[] = [];
  let neutralSkipped = 0;

  const first = WINDOW;
  const last = candles.length - horizonCandles;
  const steps: number[] = [];
  for (let i = first; i <= last; i += STRIDE) steps.push(i);

  for (let s = 0; s < steps.length; s++) {
    const i = steps[s];
    const win = candles.slice(i - WINDOW, i);
    const spot = candles[i].close;
    const cvd = computeCvd(win);
    const { longPool, shortPool, nearLongPool, nearShortPool, clusters } = estimateLiquidationMap(
      win,
      spot,
      LEVERAGES,
      RANGE_PCT,
      58,
      0,
      2
    );
    const slopes = slopesOf(win);
    const v = computeVerdict({
      spot,
      longPool,
      shortPool,
      nearLongPool,
      nearShortPool,
      clusters,
      // los factores de posicionamiento (funding, ratios, OI, takers, prima)
      // no existen históricamente en este backtest → neutros
      fundingRate: 0,
      fundingTrend: 0,
      globalRatio: 1,
      topRatio: 1,
      takerRatio: 1,
      oiChange24h: 0,
      oiSlope5m: 0,
      priceChange24h: ((spot - win[0].close) / win[0].close) * 100,
      premium: 0,
      atr1h: atrOf(win),
      liveLongLiq: 0,
      liveShortLiq: 0,
      cvdPct: cvd.cvdPct,
      cvdDiv: cvd.divergence,
      oiUsdt: 0,
      fastSlopePct: slopes.fast,
      slowSlopePct: slopes.slow,
    });

    if (v.direction === "neutral") {
      neutralSkipped++;
    } else {
      const r = resolveSignal(v, spot, candles, i + 1, horizonCandles, msPerCandle);
      tests.push({
        time: candles[i].time,
        dir: v.direction,
        headline: v.headline,
        spot,
        target: v.target?.price ?? null,
        inval: v.invalidation?.price ?? null,
        confidence: v.confidence,
        outcome: r.outcome,
        pnlPct: r.pnlPct,
        hoursToResolve: r.hours,
      });
    }

    if (s % 5 === 0) {
      onProgress(Math.round(((s + 1) / steps.length) * 100));
      await sleep(18);
    }
  }

  const hits = tests.filter((t) => t.outcome === "acierto").length;
  const misses = tests.filter((t) => t.outcome === "fallo").length;
  const expired = tests.filter((t) => t.outcome === "caducada").length;
  const closed = hits + misses;

  const bucket = (list: BtTest[]): { hits: number; closed: number } => ({
    hits: list.filter((t) => t.outcome === "acierto").length,
    closed: list.filter((t) => t.outcome !== "caducada").length,
  });

  const byBucket: BtBucket[] = [
    { label: "confianza < 50%", ...bucket(tests.filter((t) => t.confidence < 50)) },
    { label: "confianza 50–64%", ...bucket(tests.filter((t) => t.confidence >= 50 && t.confidence < 65)) },
    { label: "confianza ≥ 65%", ...bucket(tests.filter((t) => t.confidence >= 65)) },
  ];

  const equity: number[] = [];
  let acc = 0;
  for (const t of tests) {
    acc += t.pnlPct;
    equity.push(acc);
  }

  return {
    tests,
    hits,
    misses,
    expired,
    neutralSkipped,
    closed,
    hitRate: closed > 0 ? (hits / closed) * 100 : null,
    edgePct: closed > 0 ? (hits / closed) * 100 - 50 : null,
    expectancyPct: tests.length > 0 ? tests.reduce((a, t) => a + t.pnlPct, 0) / tests.length : 0,
    byDir: {
      up: { label: "SHORT SQUEEZE (alcistas)", ...bucket(tests.filter((t) => t.dir === "up")) },
      down: { label: "LONG SQUEEZE (bajistas)", ...bucket(tests.filter((t) => t.dir === "down")) },
    },
    byBucket,
    equity,
    candlesUsed: candles.length,
    windowSize: WINDOW,
    horizonH,
    sim,
  };
}
