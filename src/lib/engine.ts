/* ============================================================
   LiqRadar — motor de estimación de liquidaciones y veredicto
   V5: datos reales (aggTrade, L2 secuenciado, options IV/skew,
       Top-Trader flow), régimen state-first como guardia de
       dirección, OI regimes y absorción.
   ============================================================ */

import type { MarketRegime, OIRegime } from "./regime";
import type { ExternalCluster } from "./externalLiquidity";

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  quoteVolume: number; // USDT
  takerBuyQuote?: number; // USDT de compra agresiva (taker)
}

export interface LevPart {
  lev: number;
  v: number; // intensidad relativa 0..1 sobre el máximo global
}

export interface LiqBin {
  price: number;
  intensity: number; // 0..1
  side: "long" | "short";
  estNotional: number; // USDT estimados
  parts: LevPart[]; // contribución por apalancamiento
}

/* Colores por apalancamiento: frío (10×) → explosivo (100×) */
export const LEV_COLORS: Record<number, string> = {
  10: "#3fb6ff",
  25: "#2fd6d6",
  50: "#ffb547",
  100: "#e05cd0",
};

export interface Cluster {
  price: number;
  intensity: number;
  side: "long" | "short";
  estNotional: number;
  distancePct: number; // distancia al spot en % (positivo)
  tag: string;
}

export interface LiqEvent {
  id: string;
  time: number; // ms
  side: "long" | "short"; // lado LIQUIDADO
  price: number;
  qty: number; // BTC
  notional: number; // USDT
}

export interface Factor {
  id: string;
  label: string;
  detail: string;
  score: number; // -1..1  (negativo = long squeeze / bajista)
  weight: number;
  school?: "contrarian" | "momentum"; // escuela a la que pertenece
}

export interface Warning {
  tone: "warn" | "danger";
  text: string;
}

export interface Verdict {
  direction: "up" | "down" | "neutral";
  headline: string;
  sub: string;
  narrative: string; // historia armonizada: qué dice cada escuela y por qué manda una
  scorePct: number; // -100..100 (mezcla final)
  contrarianPct: number; // voto de la escuela contrarian (caza de liquidaciones)
  momentumPct: number; // voto de la escuela de impulso (tendencia/flujo)
  gatePct: number; // peso de la fase de caza en la mezcla (40–85%)
  harmony: number; // 0..100 — acuerdo entre las dos escuelas
  pullPct: number; // -100..100 — el imán del mapa: + = tira arriba (hacia shorts), − = tira abajo (hacia longs)
  dominantUp: Cluster | null; // el imán más fuerte ARRIBA (liquidez de shorts)
  dominantDown: Cluster | null; // el imán más fuerte ABAJO (liquidez de longs)
  confidence: number; // 0..100
  target: Cluster | null;
  invalidation: Cluster | null;
  windowH: [number, number];
  factors: Factor[];
  cascade: Cluster[]; // clusters dentro de 1 ATR (riesgo de liquidación en cadena)
  warnings: Warning[];
  regime: RegimeInfo; // régimen de volatilidad actual
}

export interface VerdictInput {
  spot: number;
  longPool: number;
  shortPool: number;
  nearLongPool: number; // pools a menos de nearPct del spot
  nearShortPool: number;
  clusters: Cluster[];
  fundingRate: number; // fracción por 8h (0.0001 = 0.01%)
  fundingTrend: number; // último funding − primero (8 liquidaciones ≈ 64h)
  globalRatio: number; // cuentas long/short
  topRatio: number; // posiciones top trader
  takerRatio: number; // volumen taker compra/venta en futuros (1h)
  oiChange24h: number; // %
  oiSlope5m: number; // pendiente del OI en 2.5h (%)
  priceChange24h: number; // %
  premium: number; // (mark − index)/index → prima de futuros
  atr1h: number; // ATR en unidades de precio por hora
  liveLongLiq: number; // USDT liquidados a longs en la sesión
  liveShortLiq: number;
  cvdPct: number; // delta neto / volumen total de la ventana
  cvdDiv: "bear" | "bull" | null;
  oiUsdt: number; // OI nocional en USDT (0 = desconocido)
  fastSlopePct: number; // tendencia del tercio reciente (%)
  slowSlopePct: number; // tendencia de toda la ventana (%)
  momPct?: number; // impulso de las últimas velas (%) → evita llamar giros prematuros
  // --- refuerzos añadidos ---
  bookImbalance: number; // ratio bid/ask del libro (≈1 = equilibrado, >1 = muro comprador)
  xCfundingGap: number; // funding Binance − media(OKX+Bybit) → sesgo de apalancamiento del venue
  fundingWindow: number; // 0..1 proximidad al settlement de funding (cada 8h UTC)
  sweep: number; // −1..1 detección de barrida reciente (mecha a través de un cluster)
  liqVelocity: number; // −1..1 aceleración de liquidaciones en los últimos minutos
  optionsPutCall: number; // put/call ratio de opciones por OI (1 = equilibrado)
  /* ---------- datos REALES V5 (si faltan, el factor se omite; nunca se inventan) ---------- */
  cvdSpotPct?: number; // CVD real spot 15m (aggTrade observado)
  cvdFutPct?: number; // CVD real futuros 15m (aggTrade observado)
  cvdReal?: boolean; // streams de trades vivos
  oiRegime?: OIRegime;
  absorbSide?: "bid" | "ask" | "none";
  absorbScore?: number; // 0..1
  spoofRisk?: number; // 0..100 (riesgo heurístico, nunca confirmado)
  posFlowZ?: number | null; // z-score del Top-Trader Position Flow
  posFlowExtreme?: "long" | "short" | null;
  optSkew?: number | null; // IV put OTM − IV call OTM
  optMaxPain?: number | null;
  marketRegime?: MarketRegime; // régimen state-first (guardia de dirección)
  externalClusters?: ExternalCluster[]; // clusters externos (CoinGlass/custom) — ESTIMADOS, opcionales
  maxWindowH?: number; // tope de la ventana temporal según el timeframe elegido (15m→48h … 1w→2160h)
  weights?: Record<string, number>; // pesos calibrados (opcional, sobrescriben los base)
}

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------
   Distancia real de liquidación con margen de mantenimiento por
   tier (MMR sube con el tier de la posición). Distancia = 1/L − MMR.
   10x → 9.0% · 25x → 3.5% · 50x → 1.5% · 100x → 0.6%
   ------------------------------------------------------------ */
import { mmrForLeverage } from "./brackets";
export const liqDistance = (L: number) => Math.max(1 / L - mmrForLeverage(L), 0.001);

/* ------------------------------------------------------------
   CVD — volumen delta acumulado (compra agresiva vs venta)
   ------------------------------------------------------------ */
export interface CvdInfo {
  series: number[];
  cvdPct: number; // -1..1
  cvdNet: number; // USDT netos
  divergence: "bear" | "bull" | null;
}

export function computeCvd(candles: Candle[]): CvdInfo {
  let cvd = 0;
  let totalQ = 0;
  const series: number[] = [];
  for (const c of candles) {
    const buy = c.takerBuyQuote ?? c.quoteVolume * (c.close >= c.open ? 0.56 : 0.44);
    const delta = 2 * buy - c.quoteVolume;
    cvd += delta;
    totalQ += c.quoteVolume;
    series.push(cvd);
  }
  const cvdPct = totalQ > 0 ? cvd / totalQ : 0;
  const n = candles.length;
  let divergence: "bear" | "bull" | null = null;
  if (n >= 9) {
    const third = Math.floor(n / 3);
    const priceNow = candles[n - 1].close;
    const priceMid = candles[n - 1 - third].close;
    const cvdNow = series[n - 1];
    const cvdMid = series[n - 1 - third];
    if (priceNow > priceMid * 1.002 && cvdNow < cvdMid) divergence = "bear";
    else if (priceNow < priceMid * 0.998 && cvdNow > cvdMid) divergence = "bull";
  }
  return { series, cvdPct, cvdNet: cvd, divergence };
}

/* ------------------------------------------------------------
   Mapa de liquidación estimado (velas + apalancamiento + OI)
   ------------------------------------------------------------ */
export function estimateLiquidationMap(
  candles: Candle[],
  spot: number,
  leverages: number[],
  rangePct: number,
  binsCount = 58,
  oiUsdt = 0,
  nearPct = 2,
  externalClusters?: ExternalCluster[]
): { bins: LiqBin[]; longPool: number; shortPool: number; nearLongPool: number; nearShortPool: number; clusters: Cluster[] } {
  const hi = spot * (1 + rangePct);
  const lo = spot * (1 - rangePct);
  const step = (hi - lo) / binsCount;
  const raw = new Float64Array(binsCount);
  const n = candles.length;

  const totalQuote = candles.reduce((a, c) => a + c.quoteVolume, 0) || 1;
  const levWeight: Record<number, number> = { 10: 1, 25: 0.85, 50: 0.68, 100: 0.5 };

  // acumulación por apalancamiento (para colorear cada uno distinto)
  const rawLev: Record<number, Float64Array> = {};
  for (const L of leverages) rawLev[L] = new Float64Array(binsCount);

  const add = (price: number, w: number, L: number) => {
    const idx = (hi - price) / step;
    const i0 = Math.floor(idx);
    for (let o = -1; o <= 1; o++) {
      const i = i0 + o;
      if (i < 0 || i >= binsCount) continue;
      const k = o === 0 ? 1 : 0.42;
      raw[i] += w * k;
      rawLev[L][i] += w * k;
    }
  };

  candles.forEach((c, i) => {
    const age = n - 1 - i;
    const recency = Math.exp(-age / (n * 0.52));
    const volW = Math.pow(c.quoteVolume / totalQuote, 0.5) * 46;
    const base = recency * volW;
    for (const L of leverages) {
      const d = liqDistance(L);
      const lw = levWeight[L] ?? 0.7;
      // longs abiertos cerca de máximos/cierre → liquidación debajo
      add(c.high * (1 - d), base * 0.9 * lw, L);
      add(c.close * (1 - d), base * 0.45 * lw, L);
      // shorts abiertos cerca de mínimos/cierre → liquidación arriba
      add(c.low * (1 + d), base * 0.9 * lw, L);
      add(c.close * (1 + d), base * 0.45 * lw, L);
    }
  });

  // suavizado (mismo kernel para el total y para cada apalancamiento)
  const smoothArr = (src: Float64Array): Float64Array => {
    const out = new Float64Array(binsCount);
    for (let i = 0; i < binsCount; i++) {
      const a = src[Math.max(0, i - 1)];
      const b = src[i];
      const c = src[Math.min(binsCount - 1, i + 1)];
      out[i] = (a + 2 * b + c) / 4;
    }
    return out;
  };
  const smooth = smoothArr(raw);
  const smoothLev: Record<number, Float64Array> = {};
  for (const L of leverages) smoothLev[L] = smoothArr(rawLev[L]);
  const max = Math.max(...Array.from(smooth), 1e-9);

  // anclaje nocional: si conocemos el OI, repartimos una fracción liquidable
  // dentro del rango; si no, estimamos desde el volumen de la ventana
  const poolScale = oiUsdt > 0 ? oiUsdt * 0.065 : totalQuote * 0.05;
  const totalSmooth = Array.from(smooth).reduce((a, b) => a + b, 0) || 1;

  const bins: LiqBin[] = [];
  let longPool = 0;
  let shortPool = 0;
  let nearLongPool = 0;
  let nearShortPool = 0;
  for (let i = 0; i < binsCount; i++) {
    const price = hi - (i + 0.5) * step;
    const estNotional = (smooth[i] / totalSmooth) * poolScale;
    const side: "long" | "short" = price < spot ? "long" : "short";
    const near = Math.abs(((price - spot) / spot) * 100) <= nearPct;
    if (side === "long") {
      longPool += estNotional;
      if (near) nearLongPool += estNotional;
    } else {
      shortPool += estNotional;
      if (near) nearShortPool += estNotional;
    }
    const parts: LevPart[] = [];
    for (const L of leverages) {
      const v = smoothLev[L][i] / max;
      if (v > 0.004) parts.push({ lev: L, v });
    }
    bins.push({ price, intensity: smooth[i] / max, side, estNotional, parts });
  }

  // detección de concentraciones (picos locales)
  const peaks: { i: number; v: number }[] = [];
  const thr = max * 0.34;
  for (let i = 1; i < binsCount - 1; i++) {
    if (smooth[i] >= thr && smooth[i] >= smooth[i - 1] && smooth[i] >= smooth[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1].i >= 3) {
        peaks.push({ i, v: smooth[i] });
      } else if (smooth[i] > peaks[peaks.length - 1].v) {
        peaks[peaks.length - 1] = { i, v: smooth[i] };
      }
    }
  }
  const top = peaks.sort((a, b) => b.v - a.v).slice(0, 8);
  let tagL = 0;
  let tagS = 0;
  const clusters: Cluster[] = top
    .map((p) => {
      const bin = bins[p.i];
      const side: "long" | "short" = bin.price < spot ? "long" : "short";
      const tag = side === "long" ? `L${++tagL}` : `S${++tagS}`;
      return {
        price: bin.price,
        intensity: bin.intensity,
        side,
        estNotional: bin.estNotional,
        distancePct: Math.abs((bin.price - spot) / spot) * 100,
        tag,
      };
    })
    .sort((a, b) => b.estNotional * b.intensity - a.estNotional * a.intensity);

  // Refuerzo con clusters EXTERNOS (CoinGlass/custom, marcados ESTIMADOS).
  // Si un cluster estimado coincide (±0.5%) con uno externo del mismo lado, su
  // nocional se refuerza: dos fuentes independientes apuntan al mismo nivel.
  // Los externos muy grandes sin coincidencia se añaden como clusters "E".
  if (externalClusters && externalClusters.length > 0 && spot > 0) {
    const TOL = 0.005;
    const used = new Set<number>();
    for (const ext of externalClusters) {
      if (!Number.isFinite(ext.price) || ext.price <= 0) continue;
      const extSide: "long" | "short" =
        ext.side === "long" ? "long" : ext.side === "short" ? "short" : ext.price < spot ? "long" : "short";
      const match = clusters.findIndex(
        (c) => !used.has(c.price as number) && c.side === extSide && Math.abs(c.price - ext.price) / ext.price <= TOL
      );
      if (match >= 0) {
        used.add(clusters[match].price as number);
        const boost = ext.sideOrigin === "provider" ? 0.45 : 0.25; // más peso si el lado viene del proveedor
        clusters[match] = { ...clusters[match], estNotional: clusters[match].estNotional * (1 + boost) };
      } else if (ext.notional > 0) {
        // cluster externo sin coincidencia estimada: se añade (lado por posición o proveedor)
        clusters.push({
          price: ext.price,
          intensity: 0.6,
          side: extSide,
          estNotional: ext.notional,
          distancePct: Math.abs((ext.price - spot) / spot) * 100,
          tag: "E",
        });
      }
    }
    clusters.sort((a, b) => b.estNotional * b.intensity - a.estNotional * a.intensity);
  }

  return { bins, longPool, shortPool, nearLongPool, nearShortPool, clusters };
}

export function atrOf(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  let sum = 0;
  const k = Math.min(24, candles.length - 1);
  for (let i = candles.length - k; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  return sum / k;
}

/* ------------------------------------------------------------
   Régimen de volatilidad (ATR como % del precio por hora).
   Clasifica el mercado para ajustar ventana temporal y confianza.
   ------------------------------------------------------------ */
export type Regime = "calm" | "normal" | "high" | "extreme";

export interface RegimeInfo {
  regime: Regime;
  atrPct: number; // ATR/h como % del spot
  label: string;
  color: string;
  windowScale: number; // multiplicador de la ventana temporal (alta vol = señales más rápidas)
  confAdj: number; // ajuste adicional de confianza
  note: string;
}

export function classifyRegime(atrPct: number): RegimeInfo {
  if (atrPct < 0.15) {
    return {
      regime: "calm",
      atrPct,
      label: "CALMA",
      color: "#3fb6ff",
      windowScale: 1.5,
      confAdj: 0,
      note: "Baja volatilidad: los sweeps tardan más en materializarse; amplía la ventana y ten paciencia.",
    };
  }
  if (atrPct < 0.45) {
    return {
      regime: "normal",
      atrPct,
      label: "NORMAL",
      color: "#2fd6a5",
      windowScale: 1,
      confAdj: 0,
      note: "Volatilidad estándar: la ventana temporal del radar aplica tal cual.",
    };
  }
  if (atrPct < 0.9) {
    return {
      regime: "high",
      atrPct,
      label: "ALTA",
      color: "#ffb547",
      windowScale: 0.6,
      confAdj: -6,
      note: "Volatilidad alta: las barridas son rápidas y violentas; ventana acortada y confianza penalizada.",
    };
  }
  return {
    regime: "extreme",
    atrPct,
    label: "EXTREMA",
    color: "#ff4d6d",
    windowScale: 0.4,
    confAdj: -12,
    note: "Volatilidad extrema: el ruido domina; reduce tamaño, amplía stops y desconfía de señales aisladas.",
  };
}

/* ------------------------------------------------------------
   Auxiliares de los factores de refuerzo
   ------------------------------------------------------------ */

/* Proximidad al settlement de funding (0, 8 y 16 UTC). Devuelve 0..1
   donde 1 = justo en la ventana (±1h). */
export function fundingProximity(nowMs: number): number {
  const h = (nowMs / 3600_000) % 8; // horas desde el último settlement
  const dist = Math.min(h, 8 - h); // distancia al settlement más cercano
  return Math.max(0, 1 - dist / 1.25);
}

/* Detección de barrida: en las últimas velas, ¿la mecha atravesó el cluster
   más cercano y el cierre volvió? >0 = barrieron shorts (alcista gastado),
   <0 = barrieron longs (bajista gastado). */
export function detectSweep(candles: Candle[], clusters: Cluster[], lookback = 6): number {
  if (candles.length < lookback + 1 || clusters.length === 0) return 0;
  const spot = candles[candles.length - 1].close;
  // cluster más cercano al spot
  const near = clusters.reduce((best, c) =>
    Math.abs(c.price - spot) < Math.abs(best.price - spot) ? c : best
  );
  let out = 0;
  for (let i = Math.max(0, candles.length - lookback); i < candles.length; i++) {
    const c = candles[i];
    if (near.price > spot) {
      // cluster arriba (shorts): mecha que lo cruza y cierra abajo = barrida de shorts
      if (c.high >= near.price && c.close < near.price) out = Math.max(out, 0.8);
    } else {
      // cluster abajo (longs): mecha que lo cruza y cierra arriba = barrida de longs
      if (c.low <= near.price && c.close > near.price) out = Math.min(out === 0 ? -0.8 : out, -0.8);
    }
  }
  return out;
}

/* Velocidad de liquidación: compara el desequilibrio long/short de los últimos
   minutos contra el de toda la sesión. >0 = se están quemando longs ahora. */
export function liqVelocityScore(events: LiqEvent[], nowMs: number, recentMs = 5 * 60_000): number {
  if (events.length < 3) return 0;
  let rL = 0, rS = 0, tL = 0, tS = 0;
  for (const e of events) {
    const isLong = e.side === "long";
    if (isLong) tL += e.notional; else tS += e.notional;
    if (nowMs - e.time <= recentMs) {
      if (isLong) rL += e.notional; else rS += e.notional;
    }
  }
  const rt = rL + rS;
  const tt = tL + tS;
  if (rt < 100_000 || tt === 0) return 0; // sin cascada reciente significativa
  const recentImb = (rL - rS) / rt;
  const totalImb = (tL - tS) / tt;
  return clamp((recentImb - totalImb) * 1.6 + recentImb * 0.5);
}

/* ------------------------------------------------------------
   Motor de veredicto: ¿short squeeze (arriba) o long squeeze (abajo)?
   ------------------------------------------------------------ */
export function computeVerdict(inp: VerdictInput): Verdict {
  const factors: Factor[] = [];
  const warnings: Warning[] = [];

  // clusters por lado (se reusan en pools, objetivo e invalidación)
  const shorts = inp.clusters.filter((c) => c.side === "short");
  const longs = inp.clusters.filter((c) => c.side === "long");
  // magnetismo con decaimiento exponencial por distancia: la liquidez grande y cercana pesa más
  const magnetism = (arr: typeof longs) =>
    arr.reduce((a, c) => a + c.estNotional * Math.exp(-c.distancePct / 2.0), 0);
  const longMag = magnetism(longs);
  const shortMag = magnetism(shorts);

  // 1 · Funding: si los longs pagan, hay multitud long → combustible bajista
  const fScore = clamp(-inp.fundingRate / 0.00035);
  factors.push({
    id: "funding",
    label: "Funding rate (perpetuos)",
    detail:
      inp.fundingRate >= 0
        ? `Longs pagan ${(inp.fundingRate * 100).toFixed(4)}% c/8h → multitud long`
        : `Shorts pagan ${(Math.abs(inp.fundingRate) * 100).toFixed(4)}% c/8h → multitud short`,
    score: fScore,
    weight: 0.08,
  });
  if (Math.abs(inp.fundingRate) >= 0.0003) {
    warnings.push({
      tone: "warn",
      text:
        inp.fundingRate > 0
          ? "Funding extremo: los longs pagan muy caro — históricamente precede sacudidas bajistas"
          : "Funding extremo: los shorts pagan muy caro — históricamente precede squeezes alcistas",
    });
  }

  // 2 · Tendencia del funding (¿la multitud sigue apilándose?)
  const ftScore = clamp(-inp.fundingTrend / 0.00018);
  factors.push({
    id: "fundingTrend",
    label: "Tendencia del funding (64h)",
    detail:
      Math.abs(inp.fundingTrend) < 0.00002
        ? "Funding estable: la multitud no crece"
        : inp.fundingTrend > 0
          ? `Funding subiendo (+${(inp.fundingTrend * 100).toFixed(4)}%): se apilan más longs`
          : `Funding cayendo (${(inp.fundingTrend * 100).toFixed(4)}%): se apilan más shorts`,
    score: ftScore,
    weight: 0.05,
  });

  // 3 · Ratio global de cuentas
  const gScore = clamp((1 - inp.globalRatio) * 1.15);
  factors.push({
    id: "global",
    label: "Cuentas retail long/short",
    detail: `${inp.globalRatio.toFixed(2)}× → ${inp.globalRatio > 1 ? "retail inclinado a LONG" : "retail inclinado a SHORT"}`,
    score: gScore,
    weight: 0.07,
  });

  // 4 · Top-Trader Position Flow (ratio + extremos estadísticos; NO es "whale positions")
  const z = inp.posFlowZ ?? null;
  let tScore = clamp((1 - inp.topRatio) * 0.95);
  let tDetail = `Ratio ${inp.topRatio.toFixed(2)} → ${inp.topRatio > 1 ? "cuentas grandes en LONG" : "cuentas grandes en SHORT"}`;
  if (z !== null && Number.isFinite(z)) {
    tScore = clamp(0.5 * tScore - 0.5 * clamp(z / 1.8));
    tDetail =
      Math.abs(z) >= 1.5
        ? `Extremo estadístico (z=${z.toFixed(1)}): cuentas grandes ${z > 0 ? "MUY en LONG" : "MUY en SHORT"} → crowded ${z > 0 ? "bajista" : "alcista"}`
        : `Ratio ${inp.topRatio.toFixed(2)} · z=${z.toFixed(1)} sobre 72h → ${Math.abs(z) < 0.75 ? "sin extremo" : z > 0 ? "sesgo long" : "sesgo short"}`;
  }
  factors.push({
    id: "top",
    label: "Top-Trader Position Flow",
    detail: tDetail,
    score: tScore,
    weight: 0.07,
  });

  // 5 · Pools de liquidación con magnetismo por decaimiento de distancia
  const totalRaw = (inp.shortPool - inp.longPool) / (inp.shortPool + inp.longPool + 1e-9);
  const decayRaw = (shortMag - longMag) / (shortMag + longMag + 1e-9);
  const pRaw = 0.65 * decayRaw + 0.35 * totalRaw;
  const pScore = clamp(pRaw * 1.7);
  const poolX = inp.shortPool > inp.longPool ? inp.shortPool / Math.max(inp.longPool, 1) : inp.longPool / Math.max(inp.shortPool, 1);
  factors.push({
    id: "pools",
    label: "Pools de liquidación",
    detail:
      pRaw >= 0
        ? `${poolX.toFixed(1)}× más shorts ARRIBA (magnetismo ${(decayRaw * 100).toFixed(0)}% neto) → imán alcista`
        : `${poolX.toFixed(1)}× más longs ABAJO (magnetismo ${(decayRaw * 100).toFixed(0)}% neto) → imán bajista`,
    score: pScore,
    weight: 0.12,
  });

  // 6 · OI REGIME: apalancamiento + dirección definen qué multitud se está formando
  const oiR = inp.oiRegime ?? "NEUTRAL";
  const oScore = oiR === "LONG_BUILD" ? -0.7 : oiR === "SHORT_BUILD" ? 0.7 : oiR === "LONG_UNWIND" ? 0.35 : oiR === "SHORT_UNWIND" ? -0.35 : 0;
  const oiDetail =
    oiR === "LONG_BUILD"
      ? "Precio↑ + OI↑: longs NUEVOS apilándose → su combustible se acumula abajo"
      : oiR === "SHORT_BUILD"
        ? "Precio↓ + OI↑: shorts NUEVOS apilándose → su combustible se acumula arriba"
        : oiR === "LONG_UNWIND"
          ? "Precio↓ + OI↓: longs cerrando → la descarga bajista ya ocurrió en parte"
          : oiR === "SHORT_UNWIND"
            ? "Precio↑ + OI↓: shorts cerrando → la descarga alcista ya ocurrió en parte"
            : `OI ${inp.oiChange24h >= 0 ? "+" : ""}${inp.oiChange24h.toFixed(1)}% · sin régimen claro de apalancamiento`;
  factors.push({
    id: "oi",
    label: "Régimen de interés abierto",
    detail: oiDetail,
    score: oScore,
    weight: 0.07,
  });

  // 7 · Pendiente del OI en 5m: apalancamiento fresco entrando AHORA
  let osScore = 0;
  let osDetail: string;
  const pxSign = Math.sign(inp.priceChange24h) || 1;
  if (inp.oiSlope5m > 0.3) {
    osScore = clamp(-Math.sign(inp.oiSlope5m) * pxSign * Math.min(1, inp.oiSlope5m / 1.5));
    osDetail =
      pxSign > 0
        ? `OI +${inp.oiSlope5m.toFixed(2)}% en 2.5h con precio al alza → longs NUEVOS entrando (combustible abajo)`
        : `OI +${inp.oiSlope5m.toFixed(2)}% en 2.5h con precio a la baja → shorts NUEVOS entrando (combustible arriba)`;
  } else if (inp.oiSlope5m < -0.3) {
    osScore = clamp(-pxSign * 0.3);
    osDetail = `OI ${inp.oiSlope5m.toFixed(2)}% en 2.5h → desapalancamiento: el movimiento ya gastó parte de su combustible`;
  } else {
    osDetail = `OI ${inp.oiSlope5m >= 0 ? "+" : ""}${inp.oiSlope5m.toFixed(2)}% en 2.5h → apalancamiento estable`;
  }
  factors.push({ id: "oiSlope", label: "OI en tiempo real (5m)", detail: osDetail, score: osScore, weight: 0.06 });

  // 8 · Flujo de takers en futuros (quién cruza el spread)
  const tkScore = clamp((1 - inp.takerRatio) * 2.2);
  factors.push({
    id: "taker",
    label: "Volumen taker futuros",
    detail:
      inp.takerRatio >= 1
        ? `Ratio ${inp.takerRatio.toFixed(2)} → dominan las compras agresivas (multitud long)`
        : `Ratio ${inp.takerRatio.toFixed(2)} → dominan las ventas agresivas (multitud short)`,
    score: tkScore,
    weight: 0.06,
  });

  // atenuación simétrica de rebote: mientras la cascada SIGUE VIVA (impulso fuerte
  // en la dirección de la liquidación), los factores de "combustible gastado" son
  // prematuros — se amortiguan para no cancelar la tendencia antes de tiempo
  const momRaw = inp.momPct ?? 0;
  const trendLive = Math.min(1, Math.abs(momRaw) / 1.0); // 0..1

  // 9 · Liquidaciones en vivo: si ya liquidaron longs, el combustible bajista se gastó
  const tot = inp.liveLongLiq + inp.liveShortLiq;
  const lRaw = tot > 0 ? (inp.liveLongLiq - inp.liveShortLiq) / tot : 0;
  // longs liquidados (lRaw>0) ocurren con precio cayendo (mom<0): si el impulso
  // aún cae, la cascada sigue viva → el rebote es prematuro
  const liveDamp = lRaw !== 0 && Math.sign(momRaw) === -Math.sign(lRaw) ? 1 - 0.65 * trendLive : 1;
  const lScore = clamp(lRaw * 1.3) * liveDamp;
  factors.push({
    id: "live",
    label: "Liquidaciones de la sesión",
    detail:
      tot === 0
        ? "Sin liquidaciones registradas aún"
        : lRaw >= 0
          ? "Ya se liquidaron más LONGS → combustible bajista gastado"
          : "Ya se liquidaron más SHORTS → combustible alcista gastado",
    score: lScore,
    weight: 0.04,
  });

  // 10 · CVD REAL (aggTrade spot + futuros): si no hay stream vivo, el factor se OMITE
  if (inp.cvdReal && inp.cvdSpotPct !== undefined && inp.cvdFutPct !== undefined) {
    const blend = 0.45 * inp.cvdSpotPct + 0.55 * inp.cvdFutPct;
    const cvdScore = clamp(-blend * 4 + (inp.cvdDiv === "bear" ? -0.35 : inp.cvdDiv === "bull" ? 0.35 : 0));
    factors.push({
      id: "cvd",
      label: "CVD real (trades observados)",
      detail:
        Math.abs(blend) < 0.015
          ? `Flujo comprador/vendedor equilibrado (spot ${(inp.cvdSpotPct * 100).toFixed(1)}% · fut ${(inp.cvdFutPct * 100).toFixed(1)}%)`
          : blend > 0
            ? `Compra agresiva REAL ${(blend * 100).toFixed(1)}% del volumen → multitud long apilada a mercado`
            : `Venta agresiva REAL ${(Math.abs(blend) * 100).toFixed(1)}% del volumen → multitud short apilada a mercado`,
      score: cvdScore,
      weight: 0.07,
    });
  }
  if (inp.cvdDiv === "bear") {
    warnings.push({ tone: "danger", text: "Divergencia CVD bajista: el precio sube sin compradores agresivos — combustible de long squeeze activo" });
  } else if (inp.cvdDiv === "bull") {
    warnings.push({ tone: "warn", text: "Divergencia CVD alcista: la venta está siendo absorbida — combustible de short squeeze activo" });
  }

  // 11 · Prima de futuros (mark vs index): futuros caros = longs apalancados
  const prScore = clamp(-inp.premium / 0.0008);
  factors.push({
    id: "premium",
    label: "Prima futuros/spot",
    detail:
      Math.abs(inp.premium) < 0.0001
        ? "Futuros a la par del spot: sin sesgo de apalancamiento"
        : inp.premium > 0
          ? `Futuros ${(inp.premium * 100).toFixed(3)}% sobre el spot → longs apalancados pagan la prima`
          : `Futuros ${(inp.premium * 100).toFixed(3)}% bajo el spot → shorts apalancados dominan`,
    score: prScore,
    weight: 0.04,
  });

  // 12 · Confluencia multi-plazo: tendencia rápida vs tendencia de fondo
  const fast = inp.fastSlopePct;
  const slow = inp.slowSlopePct;
  const aligned = Math.sign(fast) === Math.sign(slow) && Math.abs(fast) > 0.15 && Math.abs(slow) > 0.15;
  const cfScore = aligned ? clamp(Math.sign(fast) * 0.6) : Math.abs(fast) > 0.15 ? clamp(Math.sign(fast) * 0.15) : 0;
  factors.push({
    id: "mtf",
    label: "Confluencia multi-plazo",
    detail: aligned
      ? `Tendencia reciente (${fast >= 0 ? "+" : ""}${fast.toFixed(1)}%) y de fondo (${slow >= 0 ? "+" : ""}${slow.toFixed(1)}%) ALINEADAS`
      : `Tendencia reciente (${fast >= 0 ? "+" : ""}${fast.toFixed(1)}%) vs fondo (${slow >= 0 ? "+" : ""}${slow.toFixed(1)}%) en conflicto`,
    score: cfScore,
    weight: 0.05,
  });

  // 13 · Impulso de las últimas velas: confirma el squeeze en curso y evita llamar giros prematuros
  const momPct = inp.momPct ?? 0;
  const momScore = clamp(momPct / 1.2);
  factors.push({
    id: "momentum",
    label: "Impulso reciente",
    detail:
      Math.abs(momPct) < 0.15
        ? "Sin impulso definido en las últimas velas"
        : momPct > 0
          ? `Impulso alcista +${momPct.toFixed(2)}% → el squeeze alcista ya está en marcha`
          : `Impulso bajista ${momPct.toFixed(2)}% → la caza de longs ya está en marcha`,
    score: momScore,
    weight: 0.05,
  });

  // 14 · Presión del libro de órdenes: liquidez pasiva apilada de un lado
  const bk = inp.bookImbalance ?? 1;
  const bkScore = clamp(-(bk - 1) * 1.4);
  factors.push({
    id: "book",
    label: "Presión del libro (bid/ask)",
    detail:
      Math.abs(bk - 1) < 0.15
        ? "Libro equilibrado: sin muro dominante"
        : bk > 1
          ? `Muro comprador ${bk.toFixed(2)}× → liquidez pasiva LONG apilada (combustible bajista)`
          : `Muro vendedor ${(1 / bk).toFixed(2)}× → liquidez pasiva SHORT apilada (combustible alcista)`,
    score: bkScore,
    weight: 0.05,
  });

  // 15 · Barrida reciente: mecha a través de un cluster con cierre de vuelta = combustible gastado
  const sw = inp.sweep ?? 0;
  // si el impulso sigue en la dirección de la barrida, la descarga no ha terminado
  const sweepDamp = sw !== 0 && Math.sign(momRaw) === Math.sign(sw) ? 1 - 0.65 * trendLive : 1;
  factors.push({
    id: "sweep",
    label: "Barrida de liquidez reciente",
    detail:
      Math.abs(sw) < 0.25
        ? "Sin barrida reciente: la liquidez cercana sigue intacta"
        : sw > 0
          ? "Barrida de SHORTS detectada (mecha arriba) → el squeeze alcista ya descargó"
          : "Barrida de LONGS detectada (mecha abajo) → la caza de longs ya descargó",
    // signo invertido: si la barrida ya ocurrió y el precio volvió, ese combustible
    // se gastó → contribuye EN CONTRA del movimiento barrido (rechazo = reversión)
    score: clamp(-sw) * sweepDamp,
    weight: 0.04,
  });

  // 16 · Divergencia de funding entre exchanges: apalancamiento concentrado en un venue
  const xg = inp.xCfundingGap ?? 0;
  const xgScore = clamp(-xg / 0.00025);
  factors.push({
    id: "xCfunding",
    label: "Funding cross-exchange",
    detail:
      Math.abs(xg) < 0.00005
        ? "Funding alineado entre Binance/OKX/Bybit"
        : xg > 0
          ? `Binance paga +${(xg * 100).toFixed(4)}% más → longs concentrados en Binance`
          : `Binance paga ${(xg * 100).toFixed(4)}% menos → shorts concentrados en Binance`,
    score: xgScore,
    weight: 0.03,
  });

  // 17 · Ventana de funding: los settlements (cada 8h UTC) concentran sacudidas
  const fw = inp.fundingWindow ?? 0;
  const fwScore = clamp(-Math.sign(inp.fundingRate) * fw * 0.9);
  factors.push({
    id: "fundingWindow",
    label: "Ventana de settlement",
    detail:
      fw < 0.25
        ? "Lejos del settlement de funding: sin presión horaria"
        : `A ${(fw * 100).toFixed(0)}% de la ventana → riesgo de flush ${inp.fundingRate >= 0 ? "bajista (longs pagan)" : "alcista (shorts pagan)"}`,
    score: fwScore,
    weight: 0.03,
  });

  // 18 · Velocidad de liquidación: cascada activa en los últimos minutos
  const lv = inp.liqVelocity ?? 0;
  // cascada de longs (lv>0) con impulso aún cayendo → la quema sigue viva
  const velDamp = lv !== 0 && Math.sign(momRaw) === -Math.sign(lv) ? 1 - 0.65 * trendLive : 1;
  factors.push({
    id: "liqVelocity",
    label: "Velocidad de liquidación",
    detail:
      Math.abs(lv) < 0.2
        ? "Ritmo de liquidaciones estable"
        : lv > 0
          ? "Cascada de LONGS acelerándose → el combustible bajista se está quemando"
          : "Cascada de SHORTS acelerándose → el combustible alcista se está quemando",
    score: clamp(lv) * velDamp,
    weight: 0.02,
  });

  // 19 · Put/call de opciones: más puts = multitud bajista = combustible alcista (contrarian)
  const pcr = inp.optionsPutCall ?? 1;
  factors.push({
    id: "optionsPC",
    label: "Put/call de opciones",
    detail:
      Math.abs(pcr - 1) < 0.12
        ? "Opciones equilibradas entre puts y calls"
        : pcr > 1
          ? `Put/call ${pcr.toFixed(2)} → abundan los PUTS (multitud bajista) → combustible alcista`
          : `Put/call ${pcr.toFixed(2)} → abundan los CALLS (multitud alcista) → combustible bajista`,
    score: clamp((pcr - 1) / 0.5),
    weight: 0.03,
  });

  // 18 · ABSORCIÓN real (flujo agresivo + precio que no responde + profundidad que persiste)
  if (inp.absorbSide && inp.absorbSide !== "none" && (inp.absorbScore ?? 0) > 0.15) {
    const aScore = (inp.absorbSide === "bid" ? 1 : -1) * clamp((inp.absorbScore ?? 0) * 1.1);
    factors.push({
      id: "absorb",
      label: "Absorción (microestructura)",
      detail:
        inp.absorbSide === "bid"
          ? "Ventas agresivas absorbidas por compradores pasivos: el precio no cae → posible suelo"
          : "Compras agresivas absorbidas por vendedores pasivos: el precio no sube → posible techo",
      score: aScore,
      weight: 0.05,
    });
  }

  // 19 · Opciones avanzadas: skew de volatilidad + gravedad de Max Pain (aproximaciones declaradas)
  const skew = inp.optSkew;
  const mp = inp.optMaxPain;
  if ((skew !== undefined && skew !== null) || (mp !== undefined && mp !== null)) {
    let oScoreAdv = 0;
    const parts: string[] = [];
    if (skew !== null && skew !== undefined && Number.isFinite(skew)) {
      oScoreAdv += clamp((skew / 0.12) * 0.6); // puts caros → miedo de multitud → contrarian alcista
      parts.push(`skew ${(skew * 100).toFixed(1)}pts → ${skew > 0.02 ? "puts caros (miedo)" : skew < -0.02 ? "calls caros (euforia)" : "neutro"}`);
    }
    if (mp !== null && mp !== undefined && Number.isFinite(mp) && inp.spot > 0) {
      const dist = (inp.spot - mp) / inp.spot;
      oScoreAdv += clamp(-Math.sign(dist) * Math.min(1, Math.abs(dist) / 0.04) * 0.5);
      parts.push(`Max Pain ${fmtUsd(mp)} (${dist >= 0 ? "+" : ""}${(dist * 100).toFixed(1)}% del spot)`);
    }
    if (parts.length > 0) {
      factors.push({
        id: "optAdv",
        label: "Opciones: skew + Max Pain",
        detail: parts.join(" · "),
        score: clamp(oScoreAdv),
        weight: 0.04,
      });
    }
  }

  // Riesgo spoof/pull: NO es un factor direccional — reduce confianza y avisa (heurística, nunca confirmado)
  if ((inp.spoofRisk ?? 0) >= 45) {
    warnings.push({
      tone: "warn",
      text: `Riesgo de spoof/pull detectado (${Math.round(inp.spoofRisk ?? 0)}/100): liquidez grande aparece y se retira rápido. Es una heurística, no manipulación confirmada — desconfía de movimientos bruscos.`,
    });
  }

  // recalibración: si hay pesos calibrados (desde el laboratorio), se aplican aquí
  if (inp.weights && Object.keys(inp.weights).length > 0) {
    for (const f of factors) {
      const cw = inp.weights[f.id];
      if (typeof cw === "number" && cw > 0) f.weight = cw;
    }
  }

  // normalización: los factores son condicionales (solo existen si hay datos reales),
  // así que la suma de pesos presentes se escala a 1.00 exacto
  {
    const wSum = factors.reduce((a, f) => a + f.weight, 0);
    if (wSum > 0 && Math.abs(wSum - 1) > 1e-6) {
      for (const f of factors) f.weight = f.weight / wSum;
    }
  }

  /* ---------- armonización de las dos escuelas ----------
     CONTRARIAN (caza de liquidaciones): donde está la multitud, ocurre lo contrario.
     MOMENTUM (tendencia/flujo): sigue el flujo del dinero.
     La compuerta de "fase de caza" decide cuánto pesa cada escuela según el régimen. */
  const SCHOOL_OF: Record<string, "contrarian" | "momentum"> = {
    funding: "contrarian",
    fundingTrend: "contrarian",
    global: "contrarian",
    top: "contrarian",
    pools: "contrarian",
    taker: "contrarian",
    live: "contrarian",
    cvd: "contrarian",
    premium: "contrarian",
    proximity: "contrarian",
    sweep: "contrarian",
    velocity: "contrarian",
    optionsPC: "contrarian",
    oi: "momentum",
    oiSlope: "momentum",
    mtf: "momentum",
    momentum: "momentum",
    book: "momentum",
    absorb: "momentum",
    optAdv: "contrarian",
  };
  const tagged: Factor[] = factors.map((f) => ({ ...f, school: SCHOOL_OF[f.id] ?? "momentum" }));

  const cF = tagged.filter((f) => f.school === "contrarian");
  const mF = tagged.filter((f) => f.school === "momentum");
  const wC = cF.reduce((a, f) => a + f.weight, 0) || 1;
  const wM = mF.reduce((a, f) => a + f.weight, 0) || 1;
  const contrarian = cF.reduce((a, f) => a + f.score * f.weight, 0) / wC;
  const momentum = mF.reduce((a, f) => a + f.score * f.weight, 0) / wM;

  // compuerta de fase: señales de que el mercado está en "modo caza"
  const atrPct = inp.spot > 0 ? (inp.atr1h / inp.spot) * 100 : 0;
  const nearestPct = inp.clusters.length ? Math.min(...inp.clusters.map((c) => c.distancePct)) : 99;
  // el imán del mapa: hacia dónde tira la liquidez cercana (la señal ancla)
  const lp = liquidityPull(inp.clusters, atrPct);
  let gate = 0.68; // el radar es de liquidaciones: la escuela contrarian manda por defecto
  if (Math.abs(inp.fundingRate) >= 0.0003) gate += 0.08; // funding extremo → multitud apilada
  if (nearestPct <= atrPct) gate += 0.1; // combustible pegado al precio → caza inminente
  if (Math.abs(inp.oiSlope5m) >= 1) gate += 0.06; // apalancamiento entrando rápido
  if (aligned && Math.abs(cfScore) >= 0.5) gate -= 0.12; // tendencia multi-plazo limpia → deja hablar al impulso
  if (Math.abs(inp.momPct ?? 0) >= 0.8) gate -= 0.1; // impulso fuerte EN CUALQUIER dirección → la tendencia merece voz
  if (Math.abs(inp.priceChange24h) >= 4) gate -= 0.08; // movimiento 24h grande → el mercado ya eligió lado
  gate = Math.min(0.85, Math.max(0.4, gate));

  const score = gate * contrarian + (1 - gate) * momentum;

  // LA DECISIÓN ESTÁ ANCLADA EN EL MAPA: el imán de liquidez cercano manda (55%),
  // las escuelas confirman o matizan (45%). Así "hacia dónde va" lo dice lo que el
  // radar mide mejor — la liquidez alcanzable — y no un promedio diluido de 19 factores.
  const drive = 0.55 * lp.pull + 0.45 * score;

  const scorePct = Math.round(drive * 100);
  const contrarianPct = Math.round(contrarian * 100);
  const momentumPct = Math.round(momentum * 100);
  const gatePct = Math.round(gate * 100);
  const harmony = Math.round(100 * (1 - Math.abs(contrarian - momentum) / 2));

  let direction: Verdict["direction"] = "neutral";
  if (drive > 0.06) direction = "up";
  else if (drive < -0.06) direction = "down";

  // RÉGIMEN STATE-FIRST: el estado del mercado es guardia antes de emitir dirección.
  // Si el régimen no da ventaja para el lado propuesto, la señal se bloquea a NEUTRO.
  const mktRegime = inp.marketRegime;
  if (mktRegime) {
    if (direction === "up" && !mktRegime.allowUp) {
      warnings.push({ tone: "warn", text: `Señal alcista BLOQUEADA por régimen ${mktRegime.label}: ${mktRegime.note}` });
      direction = "neutral";
    } else if (direction === "down" && !mktRegime.allowDown) {
      warnings.push({ tone: "warn", text: `Señal bajista BLOQUEADA por régimen ${mktRegime.label}: ${mktRegime.note}` });
      direction = "neutral";
    }
  }

  const align = tagged.filter((f) => (direction === "neutral" ? false : Math.sign(f.score) === Math.sign(drive))).length;

  // confianza: base + magnitud del sesgo + alineación + acuerdo entre escuelas,
  // ajustada por el régimen de volatilidad (alta vol = menos certeza)
  const regime = classifyRegime(atrPct);
  const volPenalty = Math.min(16, Math.max(0, (atrPct - 0.45) * 40));
  const volAdj = Math.max(volPenalty, Math.abs(regime.confAdj)); // evita doble-penalizar
  const mtfBonus = aligned ? 5 : 0;
  const harmonyAdj = (harmony - 50) * 0.12; // acuerdo sube, discrepancia baja
  // si el imán del mapa y las escuelas tiran del mismo lado, la convicción es mayor
  const pullAgree = Math.sign(lp.pull) === Math.sign(score) && Math.abs(lp.pull) > 0.15 ? 6 : 0;
  const confidence = Math.max(15, Math.round(Math.min(93, 24 + Math.abs(drive) * 62 + align * 5 + mtfBonus + harmonyAdj + pullAgree) - volAdj));
  if (regime.regime === "high" || regime.regime === "extreme") {
    warnings.push({ tone: regime.regime === "extreme" ? "danger" : "warn", text: `Régimen de volatilidad ${regime.label} (ATR ${atrPct.toFixed(2)}%/h): ${regime.note}` });
  }

  // objetivo = el IMÁN DOMINANTE del lado hacia donde tira el precio (ponderado por
  // cercanía), no el cluster más grande aunque esté lejos: el precio barre primero lo
  // alcanzable. La invalidación es el imán dominante del lado contrario.
  const target =
    direction === "up"
      ? lp.up.cluster ?? shorts[0] ?? null
      : direction === "down"
        ? lp.down.cluster ?? longs[0] ?? null
        : null;
  const invalidation =
    direction === "up"
      ? lp.down.cluster ?? longs[0] ?? null
      : direction === "down"
        ? lp.up.cluster ?? shorts[0] ?? null
        : null;

  // cascadas: clusters a menos de 1 ATR (con suelo de 0.25% para que en timeframes
  // cortos, donde el ATR horario es diminuto, la detección siga siendo útil)
  const cascadeReach = Math.max(atrPct, 0.25);
  const cascade =
    atrPct > 0
      ? inp.clusters.filter((c) => c.distancePct <= cascadeReach).sort((a, b) => a.distancePct - b.distancePct)
      : [];
  if (cascade.length >= 2) {
    warnings.push({
      tone: "danger",
      text: `Zona de cascada: ${cascade.length} clusters a menos de 1 ATR — barrer el primero puede liquidar los siguientes en cadena`,
    });
  } else if (cascade.length === 1) {
    warnings.push({
      tone: "warn",
      text: `Cluster ${cascade[0].tag} a ${cascade[0].distancePct.toFixed(2)}% del spot (menos de 1 ATR): zona de barrida inmediata`,
    });
  }

  // discrepancia entre escuelas: se avisa en lugar de promediar en silencio
  if (Math.sign(contrarian) !== Math.sign(momentum) && Math.abs(contrarian) > 0.25 && Math.abs(momentum) > 0.25) {
    warnings.push({
      tone: "warn",
      text: `Escuelas en desacuerdo: contrarian ${contrarian > 0 ? "alcista" : "bajista"} vs impulso ${momentum > 0 ? "alcista" : "bajista"} — la confianza se reduce; espera a que un barrido defina el lado`,
    });
  }

  // ventana temporal: escalada por el régimen de volatilidad
  // (alta vol → los sweeps se resuelven más rápido → ventana más corta)
  let windowH: [number, number] = [2, 12];
  if (target && inp.atr1h > 0) {
    const h = Math.abs(target.price - inp.spot) / inp.atr1h;
    const ws = regime.windowScale;
    const cap = inp.maxWindowH ?? 96; // el tope escala con el timeframe elegido
    windowH = [Math.max(1, Math.round(h * 0.5 * ws)), Math.min(cap, Math.max(2, Math.round(h * 1.7 * ws)))];
  }

  let headline = "RANGO · SIN SESGO";
  let sub = "La liquidez está equilibrada a ambos lados. Sin combustible claro para un sweep: espera a que el funding, el CVD o los pools se desequilibren.";
  if (direction === "up") {
    headline = "SHORT SQUEEZE";
    sub = target
      ? `Presión alcista: el precio tiende a barrer la liquidez de shorts acumulada en $${Math.round(target.price).toLocaleString("en-US")} antes de decidir dirección.`
      : "Presión alcista dominante, aunque sin un cluster grande cercano definido.";
  } else if (direction === "down") {
    headline = "LONG SQUEEZE";
    sub = target
      ? `Presión bajista: el precio tiende a cazar los stops/liquidaciones de longs acumulados en $${Math.round(target.price).toLocaleString("en-US")} antes de decidir dirección.`
      : "Presión bajista dominante, aunque sin un cluster grande cercano definido.";
  }

  const narrative = buildNarrative(direction, gatePct, contrarianPct, momentumPct, harmony, target, lp.pullPct);

  return {
    direction,
    headline,
    sub,
    narrative,
    scorePct,
    contrarianPct,
    momentumPct,
    gatePct,
    harmony,
    pullPct: lp.pullPct,
    dominantUp: lp.up.cluster,
    dominantDown: lp.down.cluster,
    confidence,
    target,
    invalidation,
    windowH,
    factors: tagged,
    cascade,
    warnings,
    regime,
  };
}

/* Historia armonizada: qué dice cada escuela y por qué manda una */
function buildNarrative(
  dir: Verdict["direction"],
  gatePct: number,
  cPct: number,
  mPct: number,
  harmony: number,
  target: Cluster | null,
  pullPct: number
): string {
  const word = (v: number) => (v >= 15 ? "alcista" : v <= -15 ? "bajista" : "neutral");
  const cw = word(cPct);
  const mw = word(mPct);
  const magnet = target
    ? target.side === "short"
      ? `el imán de shorts arriba en ${fmtUsd(target.price)} tira con ${Math.abs(pullPct)}% de fuerza`
      : `el imán de longs abajo en ${fmtUsd(target.price)} tira con ${Math.abs(pullPct)}% de fuerza`
    : "sin un imán dominante definido";
  if (dir === "up") {
    const flow = mw === "alcista" ? "y el impulso acompaña" : mw === "bajista" ? "aunque el impulso aún frena" : "con el impulso sin definir";
    return `Fase de caza (peso ${gatePct}%): ${magnet}; la lectura contrarian ${cw} es la que manda, ${flow}. Armonía ${harmony}%. El precio tiende a viajar a ese imán antes de decidir dirección.`;
  }
  if (dir === "down") {
    const flow = mw === "bajista" ? "y el impulso acompaña" : mw === "alcista" ? "aunque el impulso aún frena" : "con el impulso sin definir";
    return `Fase de caza (peso ${gatePct}%): ${magnet}; la lectura contrarian ${cw} es la que manda, ${flow}. Armonía ${harmony}%. El precio tiende a cazar esas liquidaciones antes de decidir dirección.`;
  }
  if (Math.sign(cPct) !== Math.sign(mPct) && Math.abs(cPct) >= 15 && Math.abs(mPct) >= 15) {
    return `Escuelas en desacuerdo: contrarian ${cw} vs impulso ${mw} (armonía ${harmony}%). No hay ventaja clara — espera a que un barrido defina el lado.`;
  }
  return `Ni multitud definida ni impulso claro: mercado en equilibrio (armonía ${harmony}%). El radar no tiene ventaja que ofrecerte ahora mismo.`;
}

/* ------------------------------------------------------------
   Sesgo de un timeframe completo (para confluencia multi-plazo).
   Usa solo factores de acción de precio + volumen (los que se
   pueden derivar de las velas); los de datos en vivo van neutros.
   ------------------------------------------------------------ */
export interface TfBias {
  tf: string;
  label: string;
  direction: "up" | "down" | "neutral";
  scorePct: number; // -100..100
  word: string;
}

export function biasFromCandles(
  candles: Candle[],
  tf: string,
  label: string,
  msPerCandle: number,
  range: number
): TfBias {
  const spot = candles[candles.length - 1].close;
  const cvd = computeCvd(candles);
  const { longPool, shortPool, nearLongPool, nearShortPool, clusters } = estimateLiquidationMap(
    candles,
    spot,
    [10, 25, 50, 100],
    range,
    58,
    0,
    2
  );
  const n = candles.length;
  const last = spot;
  const k3 = Math.max(2, Math.floor(n / 3));
  const fastSlopePct = ((last - candles[n - 1 - k3].close) / candles[n - 1 - k3].close) * 100;
  const slowSlopePct = ((last - candles[0].close) / candles[0].close) * 100;
  const km = Math.max(2, Math.floor(n / 6));
  const momPct = ((last - candles[n - 1 - km].close) / candles[n - 1 - km].close) * 100;

  const v = computeVerdict({
    spot,
    longPool,
    shortPool,
    nearLongPool,
    nearShortPool,
    clusters,
    fundingRate: 0,
    fundingTrend: 0,
    globalRatio: 1,
    topRatio: 1,
    takerRatio: 1,
    oiChange24h: 0,
    oiSlope5m: 0,
    priceChange24h: slowSlopePct,
    premium: 0,
    atr1h: atrOf(candles) * (3600_000 / msPerCandle),
    liveLongLiq: 0,
    liveShortLiq: 0,
    cvdPct: cvd.cvdPct,
    cvdDiv: cvd.divergence,
    oiUsdt: 0,
    fastSlopePct,
    slowSlopePct,
    momPct,
    bookImbalance: 1,
    xCfundingGap: 0,
    fundingWindow: 0,
    sweep: 0,
    liqVelocity: 0,
    optionsPutCall: 1,
  });

  return {
    tf,
    label,
    direction: v.direction,
    scorePct: v.scorePct,
    word: v.direction === "up" ? "LONG" : v.direction === "down" ? "SHORT" : "NEUTRO",
  };
}

/* ------------------------------------------------------------
   Imán dominante: cuánta liquidez "tira" de cada lado, ponderada
   por cercanía. Es la señal más afilada del radar — el precio
   barre primero lo que tiene cerca, no lo que es más grande lejos.
   ------------------------------------------------------------ */
export interface Magnet {
  cluster: Cluster | null; // el imán más fuerte de ese lado
  pull: number; // 0..1 — magnetismo total del lado (normalizado)
}

export interface LiquidityPull {
  pull: number; // -1..1 — positivo = tira hacia ARRIBA (hacia los shorts)
  up: Magnet; // lado short (arriba)
  down: Magnet; // lado long (abajo)
  pullPct: number; // pull redondeado en %
}

export function liquidityPull(clusters: Cluster[], atrPct: number): LiquidityPull {
  // decaimiento por distancia: lo cercano domina (nunca atrPct=0)
  const magnet = (c: Cluster) => c.estNotional * c.intensity * Math.exp(-c.distancePct / Math.max(atrPct, 0.2));

  const ups = clusters.filter((c) => c.side === "short");
  const downs = clusters.filter((c) => c.side === "long");

  const sumMag = (list: Cluster[]) => list.reduce((a, c) => a + magnet(c), 0);
  const best = (list: Cluster[]): Cluster | null =>
    list.length ? list.reduce((a, c) => (magnet(c) > magnet(a) ? c : a), list[0]) : null;

  const upMag = sumMag(ups);
  const downMag = sumMag(downs);
  const total = upMag + downMag;

  return {
    pull: total > 0 ? (upMag - downMag) / total : 0,
    up: { cluster: best(ups), pull: total > 0 ? upMag / total : 0 },
    down: { cluster: best(downs), pull: total > 0 ? downMag / total : 0 },
    pullPct: Math.round((total > 0 ? (upMag - downMag) / total : 0) * 100),
  };
}

/* Grado de confluencia entre timeframes → 0..100 */
export function confluenceGrade(biases: TfBias[]): { grade: number; label: string; alignedDir: "up" | "down" | "mixed" | null } {
  if (biases.length === 0) return { grade: 0, label: "—", alignedDir: null };
  const ups = biases.filter((b) => b.direction === "up").length;
  const downs = biases.filter((b) => b.direction === "down").length;
  const total = biases.length;
  const dominant = Math.max(ups, downs);
  const grade = Math.round((dominant / total) * 100);
  const alignedDir = ups === downs ? "mixed" : ups > downs ? "up" : "down";
  const label =
    dominant === total
      ? alignedDir === "up"
        ? "CONFLUENCIA TOTAL · LONG"
        : "CONFLUENCIA TOTAL · SHORT"
      : dominant >= total - 1
        ? `Mayoría ${alignedDir === "up" ? "LONG" : "SHORT"}`
        : "SIN ACUERDO";
  return { grade, label, alignedDir };
}

/* ------------------------------------------------------------
   Formato
   ------------------------------------------------------------ */
export const fmtUsd = (v: number, digits = 0) =>
  "$" + v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtCompact = (v: number) => {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(1) + "K";
  return sign + "$" + a.toFixed(0);
};

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
