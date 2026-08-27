/* ============================================================
   LiqRadar — motor de estimación de liquidaciones y veredicto
   v2: margen de mantenimiento real, anclaje a OI, CVD,
       cascadas y confianza ajustada por volatilidad
   ============================================================ */

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
}

export interface Warning {
  tone: "warn" | "danger";
  text: string;
}

export interface Verdict {
  direction: "up" | "down" | "neutral";
  headline: string;
  sub: string;
  scorePct: number; // -100..100
  confidence: number; // 0..100
  target: Cluster | null;
  invalidation: Cluster | null;
  windowH: [number, number];
  factors: Factor[];
  cascade: Cluster[]; // clusters dentro de 1 ATR (riesgo de liquidación en cadena)
  warnings: Warning[];
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
  weights?: Record<string, number>; // pesos calibrados (opcional, sobrescriben los base)
}

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------
   Distancia real de liquidación con margen de mantenimiento
   Binance BTC tier 1: MMR 0.40%. Distancia = 1/L − MMR.
   10x → 9.6% · 25x → 3.6% · 50x → 1.6% · 100x → 0.6%
   ------------------------------------------------------------ */
const MMR = 0.004;
export const liqDistance = (L: number) => Math.max(1 / L - MMR, 0.001);

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
  nearPct = 2
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
    weight: 0.11,
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
    weight: 0.06,
  });

  // 3 · Ratio global de cuentas
  const gScore = clamp((1 - inp.globalRatio) * 1.15);
  factors.push({
    id: "global",
    label: "Cuentas retail long/short",
    detail: `${inp.globalRatio.toFixed(2)}× → ${inp.globalRatio > 1 ? "retail inclinado a LONG" : "retail inclinado a SHORT"}`,
    score: gScore,
    weight: 0.08,
  });

  // 4 · Top traders (posiciones)
  const tScore = clamp((1 - inp.topRatio) * 0.95);
  factors.push({
    id: "top",
    label: "Posiciones de top traders",
    detail: `Ratio ${inp.topRatio.toFixed(2)} → ${inp.topRatio > 1 ? "ballenas en LONG" : "ballenas en SHORT"}`,
    score: tScore,
    weight: 0.09,
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
    weight: 0.16,
  });

  // 6 · Interés abierto + tendencia 24h
  const oScore = clamp(Math.sign(inp.priceChange24h) * Math.min(1, Math.abs(inp.oiChange24h) / 6));
  factors.push({
    id: "oi",
    label: "Interés abierto + impulso 24h",
    detail: `OI ${inp.oiChange24h >= 0 ? "+" : ""}${inp.oiChange24h.toFixed(1)}% · precio ${inp.priceChange24h >= 0 ? "+" : ""}${inp.priceChange24h.toFixed(1)}%`,
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
  factors.push({ id: "oiSlope", label: "OI en tiempo real (5m)", detail: osDetail, score: osScore, weight: 0.07 });

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
    weight: 0.07,
  });

  // 9 · Liquidaciones en vivo: si ya liquidaron longs, el combustible bajista se gastó
  const tot = inp.liveLongLiq + inp.liveShortLiq;
  const lRaw = tot > 0 ? (inp.liveLongLiq - inp.liveShortLiq) / tot : 0;
  const lScore = clamp(lRaw * 1.3);
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
    weight: 0.06,
  });

  // 10 · Delta de takers spot (CVD): compra agresiva = multitud long apilada
  const cvdBase = clamp(-inp.cvdPct * 3);
  const cvdScore = clamp(cvdBase + (inp.cvdDiv === "bear" ? -0.35 : inp.cvdDiv === "bull" ? 0.35 : 0));
  factors.push({
    id: "cvd",
    label: "Delta spot (CVD)",
    detail:
      inp.cvdDiv === "bear"
        ? "Divergencia: precio sube sin compra agresiva → compradores agotados"
        : inp.cvdDiv === "bull"
          ? "Divergencia: precio baja pero absorben la venta → vendedores agotados"
          : `Compra neta ${(inp.cvdPct * 100).toFixed(1)}% del volumen → ${inp.cvdPct > 0.02 ? "multitud comprando en ask" : inp.cvdPct < -0.02 ? "multitud vendiendo en bid" : "flujo equilibrado"}`,
    score: cvdScore,
    weight: 0.06,
  });
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
    weight: 0.05,
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
    weight: 0.06,
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
    weight: 0.06,
  });

  // recalibración: si hay pesos calibrados (desde el laboratorio), se aplican aquí
  if (inp.weights && Object.keys(inp.weights).length > 0) {
    for (const f of factors) {
      const cw = inp.weights[f.id];
      if (typeof cw === "number" && cw > 0) f.weight = cw;
    }
  }

  const wSum = factors.reduce((a, f) => a + f.weight, 0);
  const score = factors.reduce((a, f) => a + f.score * f.weight, 0) / wSum;
  const scorePct = Math.round(score * 100);

  let direction: Verdict["direction"] = "neutral";
  if (score > 0.14) direction = "up";
  else if (score < -0.14) direction = "down";

  const align = factors.filter((f) => (direction === "neutral" ? false : Math.sign(f.score) === Math.sign(score))).length;

  // confianza: base + magnitud del sesgo + alineación de factores,
  // penalizada por volatilidad extrema (régimen ATR alto = menos certeza)
  const atrPct = inp.spot > 0 ? (inp.atr1h / inp.spot) * 100 : 0;
  const volPenalty = Math.min(16, Math.max(0, (atrPct - 0.45) * 40));
  const mtfBonus = aligned ? 5 : 0;
  const confidence = Math.max(15, Math.round(Math.min(93, 24 + Math.abs(score) * 62 + align * 5 + mtfBonus) - volPenalty));
  if (volPenalty >= 10) {
    warnings.push({ tone: "warn", text: `Volatilidad elevada (ATR ${atrPct.toFixed(2)}%/h): confianza reducida, las barridas son más violentas e impredecibles` });
  }

  const target = direction === "up" ? shorts[0] ?? null : direction === "down" ? longs[0] ?? null : null;
  const invalidation = direction === "up" ? longs[0] ?? null : direction === "down" ? shorts[0] ?? null : null;

  // cascadas: clusters dentro de 1 ATR del spot → un sweep puede encadenarse
  const cascade =
    atrPct > 0
      ? inp.clusters.filter((c) => c.distancePct <= atrPct).sort((a, b) => a.distancePct - b.distancePct)
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

  let windowH: [number, number] = [2, 12];
  if (target && inp.atr1h > 0) {
    const h = Math.abs(target.price - inp.spot) / inp.atr1h;
    windowH = [Math.max(1, Math.round(h * 0.5)), Math.min(96, Math.max(2, Math.round(h * 1.7)))];
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

  return { direction, headline, sub, scorePct, confidence, target, invalidation, windowH, factors, cascade, warnings };
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
