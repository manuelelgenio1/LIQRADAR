/* ============================================================
   LiqRadar — motor de estimación de liquidaciones y veredicto
   ============================================================ */

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  quoteVolume: number; // USDT
}

export interface LiqBin {
  price: number;
  intensity: number; // 0..1
  side: "long" | "short";
  estNotional: number; // USDT estimados
}

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
  score: number; // -1..1  (negativo = presión bajista / long squeeze)
  weight: number;
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
}

export interface VerdictInput {
  spot: number;
  longPool: number;
  shortPool: number;
  clusters: Cluster[];
  fundingRate: number; // fracción por 8h (0.0001 = 0.01%)
  globalRatio: number; // cuentas long/short
  topRatio: number; // posiciones top traders
  oiChange24h: number; // %
  priceChange24h: number; // %
  atr1h: number;
  liveLongLiq: number; // USDT liquidados a longs en la sesión
  liveShortLiq: number;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------
   Mapa de liquidación estimado a partir de velas + apalancamiento
   ------------------------------------------------------------ */
export function estimateLiquidationMap(
  candles: Candle[],
  spot: number,
  leverages: number[],
  rangePct: number,
  binsCount = 58
): { bins: LiqBin[]; longPool: number; shortPool: number; clusters: Cluster[] } {
  const hi = spot * (1 + rangePct);
  const lo = spot * (1 - rangePct);
  const step = (hi - lo) / binsCount;
  const raw = new Float64Array(binsCount);
  const n = candles.length;

  const totalQuote = candles.reduce((a, c) => a + c.quoteVolume, 0) || 1;
  const levWeight: Record<number, number> = { 10: 1, 25: 0.85, 50: 0.68, 100: 0.5 };

  const add = (price: number, w: number) => {
    const idx = (hi - price) / step;
    const i0 = Math.floor(idx);
    for (let o = -1; o <= 1; o++) {
      const i = i0 + o;
      if (i < 0 || i >= binsCount) continue;
      const k = o === 0 ? 1 : 0.42;
      raw[i] += w * k;
    }
  };

  candles.forEach((c, i) => {
    const age = n - 1 - i;
    const recency = Math.exp(-age / (n * 0.52));
    const volW = Math.pow(c.quoteVolume / totalQuote, 0.5) * 46;
    const base = recency * volW;
    for (const L of leverages) {
      const d = 0.985 / L;
      const lw = levWeight[L] ?? 0.7;
      // longs abiertos cerca de máximos/cierre → su liquidación cae debajo
      add(c.high * (1 - d), base * 0.9 * lw);
      add(c.close * (1 - d), base * 0.45 * lw);
      // shorts abiertos cerca de mínimos/cierre → su liquidación queda arriba
      add(c.low * (1 + d), base * 0.9 * lw);
      add(c.close * (1 + d), base * 0.45 * lw);
    }
  });

  // suavizado
  const smooth = new Float64Array(binsCount);
  for (let i = 0; i < binsCount; i++) {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(binsCount - 1, i + 1)];
    smooth[i] = (a + 2 * b + c) / 4;
  }
  const max = Math.max(...Array.from(smooth), 1e-9);

  const bins: LiqBin[] = [];
  for (let i = 0; i < binsCount; i++) {
    const price = hi - (i + 0.5) * step;
    bins.push({
      price,
      intensity: smooth[i] / max,
      side: price < spot ? "long" : "short",
      estNotional: (smooth[i] / max) * totalQuote * 0.055 * (1 / Math.sqrt(leverages.length || 1)),
    });
  }

  const longPool = bins.filter((b) => b.side === "long").reduce((a, b) => a + b.estNotional * b.intensity, 0) +
    bins.filter((b) => b.side === "long").reduce((a, b) => a + b.intensity, 0) * 1e6;
  const shortPool = bins.filter((b) => b.side === "short").reduce((a, b) => a + b.estNotional * b.intensity, 0) +
    bins.filter((b) => b.side === "short").reduce((a, b) => a + b.intensity, 0) * 1e6;

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

  return { bins, longPool, shortPool, clusters };
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
    weight: 0.2,
  });

  // 2 · Ratio global de cuentas
  const gScore = clamp((1 - inp.globalRatio) * 1.15);
  factors.push({
    id: "global",
    label: "Cuentas retail long/short",
    detail: `${inp.globalRatio.toFixed(2)}× → ${inp.globalRatio > 1 ? "retail inclinado a LONG" : "retail inclinado a SHORT"}`,
    score: gScore,
    weight: 0.15,
  });

  // 3 · Top traders (posiciones)
  const tScore = clamp((1 - inp.topRatio) * 0.95);
  factors.push({
    id: "top",
    label: "Posiciones de top traders",
    detail: `Ratio ${inp.topRatio.toFixed(2)} → ${inp.topRatio > 1 ? "ballenas en LONG" : "ballenas en SHORT"}`,
    score: tScore,
    weight: 0.17,
  });

  // 4 · Desequilibrio de pools de liquidación (imán de liquidez)
  const pRaw = (inp.shortPool - inp.longPool) / (inp.shortPool + inp.longPool + 1e-9);
  const pScore = clamp(pRaw * 1.7);
  const poolX = inp.shortPool > inp.longPool ? inp.shortPool / Math.max(inp.longPool, 1) : inp.longPool / Math.max(inp.shortPool, 1);
  factors.push({
    id: "pools",
    label: "Pools de liquidación",
    detail:
      pRaw >= 0
        ? `${poolX.toFixed(1)}× más liquidez de shorts ARRIBA → imán alcista`
        : `${poolX.toFixed(1)}× más liquidez de longs ABAJO → imán bajista`,
    score: pScore,
    weight: 0.24,
  });

  // 5 · Interés abierto + tendencia 24h
  const oScore = clamp(Math.sign(inp.priceChange24h) * Math.min(1, Math.abs(inp.oiChange24h) / 6));
  factors.push({
    id: "oi",
    label: "Interés abierto + impulso 24h",
    detail: `OI ${inp.oiChange24h >= 0 ? "+" : ""}${inp.oiChange24h.toFixed(1)}% · precio ${inp.priceChange24h >= 0 ? "+" : ""}${inp.priceChange24h.toFixed(1)}%`,
    score: oScore,
    weight: 0.12,
  });

  // 6 · Liquidaciones en vivo: si ya liquidaron longs, el combustible bajista se gastó
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
          ? `Ya se liquidaron más LONGS → combustible bajista gastado`
          : `Ya se liquidaron más SHORTS → combustible alcista gastado`,
    score: lScore,
    weight: 0.12,
  });

  const wSum = factors.reduce((a, f) => a + f.weight, 0);
  const score = factors.reduce((a, f) => a + f.score * f.weight, 0) / wSum;
  const scorePct = Math.round(score * 100);

  let direction: Verdict["direction"] = "neutral";
  if (score > 0.14) direction = "up";
  else if (score < -0.14) direction = "down";

  const align = factors.filter((f) => (direction === "neutral" ? false : Math.sign(f.score) === Math.sign(score))).length;
  const confidence = Math.round(Math.min(93, 24 + Math.abs(score) * 62 + align * 5));

  const shorts = inp.clusters.filter((c) => c.side === "short");
  const longs = inp.clusters.filter((c) => c.side === "long");
  const target = direction === "up" ? shorts[0] ?? null : direction === "down" ? longs[0] ?? null : null;
  const invalidation = direction === "up" ? longs[0] ?? null : direction === "down" ? shorts[0] ?? null : null;

  let windowH: [number, number] = [2, 12];
  if (target && inp.atr1h > 0) {
    const h = Math.abs(target.price - inp.spot) / inp.atr1h;
    windowH = [Math.max(1, Math.round(h * 0.5)), Math.min(96, Math.max(2, Math.round(h * 1.7)))];
  }

  let headline = "RANGO · SIN SESGO";
  let sub = "La liquidez está equilibrada a ambos lados. Sin combustible claro para un sweep: espera a que el funding o los pools se desequilibren.";
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

  return { direction, headline, sub, scorePct, confidence, target, invalidation, windowH, factors };
}

/* ------------------------------------------------------------
   Formato
   ------------------------------------------------------------ */
export const fmtUsd = (v: number, digits = 0) =>
  "$" + v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtCompact = (v: number) => {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(0);
};

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
