import type { Candle, LiqEvent } from "./engine";

/* ================= REST ================= */

async function getJson<T>(url: string, timeoutMs = 6500): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

const SPOT = "https://api.binance.com";
const FUT = "https://fapi.binance.com";

export async function fetchKlines(interval: string, limit: number): Promise<Candle[]> {
  const raw = await getJson<(string | number)[][]>(
    `${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  );
  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    quoteVolume: Number(k[7]),
    takerBuyQuote: Number(k[10]),
  }));
}

export interface Ticker24h {
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
}

export async function fetchTicker24h(): Promise<Ticker24h> {
  const r = await getJson<Record<string, string>>(`${SPOT}/api/v3/ticker/24hr?symbol=BTCUSDT`);
  return {
    lastPrice: Number(r.lastPrice),
    priceChangePercent: Number(r.priceChangePercent),
    highPrice: Number(r.highPrice),
    lowPrice: Number(r.lowPrice),
    quoteVolume: Number(r.quoteVolume),
  };
}

/* --------- profundidad del libro (order book L2) --------- */
export interface BookLevel {
  price: number;
  qty: number; // BTC
  notional: number; // USDT
}

export interface OrderBook {
  bids: BookLevel[]; // ordenadas de mayor a menor precio
  asks: BookLevel[]; // ordenadas de menor a mayor precio
  mid: number;
}

export async function fetchOrderBook(limit = 100): Promise<OrderBook> {
  const r = await getJson<{ bids: string[][]; asks: string[][] }>(
    `${SPOT}/api/v3/depth?symbol=BTCUSDT&limit=${limit}`
  );
  const bids = r.bids.map((b) => {
    const price = Number(b[0]);
    const qty = Number(b[1]);
    return { price, qty, notional: price * qty };
  });
  const asks = r.asks.map((a) => {
    const price = Number(a[0]);
    const qty = Number(a[1]);
    return { price, qty, notional: price * qty };
  });
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  return { bids, asks, mid: bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk };
}

export async function fetchFunding(): Promise<{ rate: number; mark: number; index: number; nextTime: number }> {
  const r = await getJson<Record<string, string>>(`${FUT}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
  return {
    rate: Number(r.lastFundingRate),
    mark: Number(r.markPrice),
    index: Number(r.indexPrice),
    nextTime: Number(r.nextFundingTime),
  };
}

/* Historial de funding (8 liquidaciones ≈ 64h) → tendencia de la multitud */
export async function fetchFundingHistory(): Promise<number[]> {
  const r = await getJson<{ fundingRate: string }[]>(`${FUT}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8`);
  return r.map((x) => Number(x.fundingRate));
}

/* Ratio de volumen taker compra/venta en futuros (agresividad real) */
export async function fetchTakerRatio(): Promise<{ ratio: number; trend: number }> {
  const r = await getJson<{ buySellRatio: string }[]>(
    `${FUT}/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=1h&limit=7`
  );
  const vals = r.map((x) => Number(x.buySellRatio));
  const ratio = vals[vals.length - 1] ?? 1;
  const trend = ratio - (vals[0] ?? ratio);
  return { ratio, trend };
}

/* Pendiente del interés abierto en velas de 5 min (≈ 2.5h) */
export async function fetchOI5mSlope(): Promise<number> {
  const r = await getJson<{ sumOpenInterest: string }[]>(
    `${FUT}/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=30`
  );
  if (r.length < 2) return 0;
  const first = Number(r[0].sumOpenInterest);
  const last = Number(r[r.length - 1].sumOpenInterest);
  return first > 0 ? ((last - first) / first) * 100 : 0;
}

export interface OIPoint {
  time: number; // unix seconds
  oi: number; // BTC
}

/* Historial de interés abierto en la granularidad del gráfico (para overlay) */
export async function fetchOIHistory(interval: string, limit: number): Promise<OIPoint[]> {
  const r = await getJson<{ sumOpenInterest: string; timestamp: number }[]>(
    `${FUT}/futures/data/openInterestHist?symbol=BTCUSDT&period=${interval}&limit=${limit}`
  );
  return r.map((x) => ({ time: Math.floor(Number(x.timestamp) / 1000), oi: Number(x.sumOpenInterest) }));
}

export interface SeriesPoint {
  time: number; // unix seconds
  value: number;
}

/* Historial del funding rate (~30 días, 1 punto cada 8h) */
export async function fetchFundingSeries(limit = 90): Promise<SeriesPoint[]> {
  const r = await getJson<{ fundingRate: string; fundingTime: number }[]>(
    `${FUT}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${limit}`
  );
  return r.map((x) => ({ time: Math.floor(Number(x.fundingTime) / 1000), value: Number(x.fundingRate) }));
}

/* Historial del ratio long/short de cuentas (period: 1h/4h/1d) */
export async function fetchAccountRatioSeries(period: string, limit: number): Promise<SeriesPoint[]> {
  const r = await getJson<{ longShortRatio: string; timestamp: number }[]>(
    `${FUT}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=${limit}`
  );
  return r.map((x) => ({ time: Math.floor(Number(x.timestamp) / 1000), value: Number(x.longShortRatio) }));
}

/* Historial del ratio de volumen taker compra/venta */
export async function fetchTakerSeries(period: string, limit: number): Promise<SeriesPoint[]> {
  const r = await getJson<{ buySellRatio: string; timestamp: number }[]>(
    `${FUT}/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=${period}&limit=${limit}`
  );
  return r.map((x) => ({ time: Math.floor(Number(x.timestamp) / 1000), value: Number(x.buySellRatio) }));
}

/* Simuladores coherentes para red restringida */
export function simSeries(base: number, vol: number, count: number, stepMs: number): SeriesPoint[] {
  const now = Date.now();
  let v = base;
  const out: SeriesPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    v = v * (1 + (rnd() - 0.5) * vol) + base * (rnd() - 0.5) * vol * 0.15;
    out.push({ time: Math.floor((now - i * stepMs) / 1000), value: v });
  }
  return out;
}

export async function fetchOpenInterest(): Promise<{ oi: number; change24hPct: number }> {
  const [oi, hist] = await Promise.all([
    getJson<{ openInterest: string }>(`${FUT}/fapi/v1/openInterest?symbol=BTCUSDT`),
    getJson<{ sumOpenInterest: string; timestamp: number }[]>(
      `${FUT}/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=26`
    ),
  ]);
  const now = Number(oi.openInterest);
  const past = hist.length > 1 ? Number(hist[0].sumOpenInterest) : now;
  return { oi: now, change24hPct: past > 0 ? ((now - past) / past) * 100 : 0 };
}

/* Desequilibrio del libro de órdenes: volumen bid vs ask en los 25 mejores niveles.
   Devuelve ratio bid/ask (≈1 equilibrado, >1 muro comprador, <1 muro vendedor). */
export async function fetchBookRatio(): Promise<number> {
  const d = await getJson<{ bids: [string, string][]; asks: [string, string][] }>(
    `${SPOT}/api/v3/depth?symbol=BTCUSDT&limit=25`
  );
  const bidVol = d.bids.reduce((a, [, q]) => a + Number(q), 0);
  const askVol = d.asks.reduce((a, [, q]) => a + Number(q), 0);
  return askVol > 0 ? bidVol / askVol : 1;
}

export async function fetchRatios(): Promise<{ global: number; top: number }> {
  const [g, t] = await Promise.all([
    getJson<{ longShortRatio: string }[]>(
      `${FUT}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1`
    ),
    getJson<{ longShortRatio: string }[]>(
      `${FUT}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1`
    ),
  ]);
  return { global: Number(g[0]?.longShortRatio ?? 1), top: Number(t[0]?.longShortRatio ?? 1) };
}

/* ================= WebSocket ================= */

export function connectWs(
  url: string,
  onMessage: (data: unknown) => void,
  onDead: () => void,
  retries = 2
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let guard: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      onDead();
      return;
    }
    guard = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        ws.close();
      }
    }, 7000);
    ws.onopen = () => {
      attempts = 0;
      if (guard) clearTimeout(guard);
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string));
      } catch {
        /* noop */
      }
    };
    ws.onclose = () => {
      if (guard) clearTimeout(guard);
      if (closed) return;
      if (attempts < retries) {
        attempts++;
        setTimeout(open, 1600 * attempts);
      } else {
        onDead();
      }
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    if (guard) clearTimeout(guard);
    ws?.close();
  };
}

/* ================= Simulador (fallback sin red) ================= */

let seed = 20260214;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.6;

export function simKlines(spot: number, count: number, intervalMs: number): Candle[] {
  const sigma = 0.0052 * Math.sqrt(intervalMs / 3600000);
  const closes: number[] = [spot];
  for (let i = 1; i < count; i++) {
    closes.push(closes[i - 1] / (1 + gauss() * sigma));
  }
  closes.reverse();
  const now = Math.floor(Date.now() / intervalMs) * intervalMs;
  return closes.map((close, i) => {
    const open = i === 0 ? close * (1 + gauss() * sigma * 0.5) : closes[i - 1];
    const hi = Math.max(open, close) * (1 + Math.abs(gauss()) * sigma * 0.6);
    const lo = Math.min(open, close) * (1 - Math.abs(gauss()) * sigma * 0.6);
    const quoteVolume = 8e6 * Math.pow(10, rnd() * 1.7) * (1 + Math.abs(hi - lo) / open / sigma / 3);
    const buyShare = 0.5 + (close >= open ? 0.09 : -0.09) + (rnd() - 0.5) * 0.12;
    return {
      time: Math.floor((now - (count - 1 - i) * intervalMs) / 1000),
      open,
      high: hi,
      low: lo,
      close,
      quoteVolume,
      takerBuyQuote: quoteVolume * buyShare,
    };
  });
}

export function simTick(prev: number): number {
  return prev * (1 + gauss() * 0.00045);
}

export function simLiqEvent(spot: number, biasLong: number): LiqEvent {
  const side: "long" | "short" = rnd() < biasLong ? "long" : "short";
  const drift = (side === "long" ? -1 : 1) * (0.0004 + rnd() * 0.003);
  const price = spot * (1 + drift);
  const qty = Math.pow(10, rnd() * 2.4 - 2.4) * (0.4 + rnd() * 2.2);
  return {
    id: `sim-${Date.now()}-${Math.floor(rnd() * 1e6)}`,
    time: Date.now(),
    side,
    price,
    qty,
    notional: qty * price,
  };
}
