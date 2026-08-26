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

export async function fetchFunding(): Promise<{ rate: number; mark: number; nextTime: number }> {
  const r = await getJson<Record<string, string>>(`${FUT}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
  return { rate: Number(r.lastFundingRate), mark: Number(r.markPrice), nextTime: Number(r.nextFundingTime) };
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
    return {
      time: Math.floor((now - (count - 1 - i) * intervalMs) / 1000),
      open,
      high: hi,
      low: lo,
      close,
      quoteVolume: 8e6 * Math.pow(10, rnd() * 1.7) * (1 + Math.abs(hi - lo) / open / sigma / 3),
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
