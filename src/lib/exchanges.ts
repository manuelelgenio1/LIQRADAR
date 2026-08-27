/* ============================================================
   Radar multi-exchange: BTC en Binance vs OKX vs Bybit.
   Endpoints públicos oficiales de cada exchange (con CORS).
   ============================================================ */

export interface ExchangeQuote {
  exchange: "binance" | "okx" | "bybit";
  price: number;
  change24h: number; // %
  fundingRate: number; // fracción por periodo
  oiUsdt: number; // interés abierto nocional en USDT
  ok: boolean;
}

async function fetchJson<T>(url: string, timeoutMs = 6000): Promise<T> {
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

interface BybitTicker {
  result: { list: { lastPrice: string; price24hPcnt: string; fundingRate: string; openInterestValue: string }[] };
}

export async function fetchBybit(): Promise<ExchangeQuote> {
  const r = await fetchJson<BybitTicker>("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT");
  const t = r.result?.list?.[0];
  if (!t) throw new Error("bybit sin datos");
  return {
    exchange: "bybit",
    price: Number(t.lastPrice),
    change24h: Number(t.price24hPcnt) * 100,
    fundingRate: Number(t.fundingRate),
    oiUsdt: Number(t.openInterestValue),
    ok: true,
  };
}

interface OkxTicker {
  data: { last: string; open24h: string }[];
}
interface OkxFunding {
  data: { fundingRate: string }[];
}
interface OkxOI {
  data: { oi: string }[];
}

export async function fetchOkx(): Promise<ExchangeQuote> {
  const [tk, fd, oi] = await Promise.all([
    fetchJson<OkxTicker>("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP"),
    fetchJson<OkxFunding>("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP"),
    fetchJson<OkxOI>("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP"),
  ]);
  const last = Number(tk.data[0].last);
  const open = Number(tk.data[0].open24h);
  const contracts = Number(oi.data[0].oi); // contratos (ctVal = 0.01 BTC)
  return {
    exchange: "okx",
    price: last,
    change24h: open > 0 ? ((last - open) / open) * 100 : 0,
    fundingRate: Number(fd.data[0].fundingRate),
    oiUsdt: contracts * 0.01 * last,
    ok: true,
  };
}

/** Binance se alimenta de los datos en vivo que ya tiene el radar (props) */
export function binanceQuote(price: number, change24h: number, fundingRate: number, oiBtc: number): ExchangeQuote {
  return {
    exchange: "binance",
    price,
    change24h,
    fundingRate,
    oiUsdt: oiBtc > 0 ? oiBtc * price : 0,
    ok: price > 0,
  };
}

export const EXCHANGE_LABEL: Record<ExchangeQuote["exchange"], string> = {
  binance: "BINANCE",
  okx: "OKX",
  bybit: "BYBIT",
};

export const EXCHANGE_COLOR: Record<ExchangeQuote["exchange"], string> = {
  binance: "#ffb547",
  okx: "#e9f1ff",
  bybit: "#3fb6ff",
};
