/* ============================================================
   Trades REALES vía aggTrade (spot + futuros).
   El CVD se calcula con ejecuciones observadas, no derivado de
   velas: delta = +qty·price si el comprador cruzó el ask (m=false),
   −qty·price si el vendedor cruzó el bid (m=true).
   ============================================================ */

import { markSource, safeNum } from "./dataTruth";

export interface TradeTick {
  time: number;
  price: number;
  qty: number;
  notional: number;
  market: "spot" | "fut";
  sellAggr: boolean; // true = venta agresiva
}

interface DeltaPoint {
  t: number;
  d: number;
  n: number; // notional absoluto
}

/* Anillo de trades para el REPLAY de microestructura (futuros).
   Guarda tiempo/precio/lado/notional para poder rebobinar la cinta. */
export interface TradeEvent {
  t: number; // ms epoch
  p: number; // price
  sell: boolean; // venta agresiva
  n: number; // notional
}
const TRADES_CAP = 6000;
const futTradesBuf: TradeEvent[] = [];
function pushTrade(e: TradeEvent) {
  futTradesBuf.push(e);
  if (futTradesBuf.length > TRADES_CAP) futTradesBuf.shift();
}
export function getFutTrades(): TradeEvent[] {
  return futTradesBuf;
}

const CAP = 9000;
const spotBuf: DeltaPoint[] = [];
const futBuf: DeltaPoint[] = [];
let spotLast = 0;
let futLast = 0;

function push(buf: DeltaPoint[], p: DeltaPoint) {
  buf.push(p);
  if (buf.length > CAP) buf.shift();
}

function windowStats(buf: DeltaPoint[], ms: number): { cvd: number; vol: number; pct: number; count: number } {
  const cutoff = Date.now() - ms;
  let cvd = 0;
  let vol = 0;
  let count = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const p = buf[i];
    if (p.t < cutoff) break;
    cvd += p.d;
    vol += p.n;
    count++;
  }
  return { cvd, vol, pct: vol > 0 ? cvd / vol : 0, count };
}

export interface CvdState {
  cvd1m: number;
  cvd5m: number;
  cvd15m: number;
  pct5m: number; // -1..1 sobre volumen
  pct15m: number;
  net: number; // desde el arranque
  trades: number;
  lastAt: number;
}

let spotNet = 0;
let futNet = 0;
let spotTrades = 0;
let futTrades = 0;

export function getSpotCvd(): CvdState {
  const w1 = windowStats(spotBuf, 60_000);
  const w5 = windowStats(spotBuf, 300_000);
  const w15 = windowStats(spotBuf, 900_000);
  return { cvd1m: w1.cvd, cvd5m: w5.cvd, cvd15m: w15.cvd, pct5m: w5.pct, pct15m: w15.pct, net: spotNet, trades: spotTrades, lastAt: spotLast };
}

export function getFutCvd(): CvdState {
  const w1 = windowStats(futBuf, 60_000);
  const w5 = windowStats(futBuf, 300_000);
  const w15 = windowStats(futBuf, 900_000);
  return { cvd1m: w1.cvd, cvd5m: w5.cvd, cvd15m: w15.cvd, pct5m: w5.pct, pct15m: w15.pct, net: futNet, trades: futTrades, lastAt: futLast };
}

interface AggEvent {
  T?: number;
  p?: string;
  q?: string;
  m?: boolean;
}

function onMsg(market: "spot" | "fut", raw: string) {
  let e: AggEvent;
  try {
    e = JSON.parse(raw) as AggEvent;
  } catch {
    return;
  }
  const price = safeNum(e.p, 0);
  const qty = safeNum(e.q, 0);
  if (price <= 0 || qty <= 0 || typeof e.m !== "boolean" || typeof e.T !== "number") return;
  const notional = price * qty;
  const d = e.m ? -notional : notional; // m=true → comprador es maker → venta agresiva
  const t = e.T;
  if (market === "spot") {
    push(spotBuf, { t, d, n: notional });
    spotNet += d;
    spotTrades++;
    spotLast = Date.now();
    markSource("trades_spot", "real");
  } else {
    push(futBuf, { t, d, n: notional });
    futNet += d;
    futTrades++;
    futLast = Date.now();
    pushTrade({ t, p: price, sell: e.m === true, n: notional });
    markSource("trades_fut", "real");
  }
}

function connect(url: string, market: "spot" | "fut"): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempts = 0;

  const open = () => {
    if (closed) return;
    markSource(market === "spot" ? "trades_spot" : "trades_fut", "connecting");
    try {
      ws = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    ws.onmessage = (ev) => onMsg(market, String(ev.data));
    ws.onopen = () => {
      attempts = 0;
    };
    ws.onclose = () => {
      markSource(market === "spot" ? "trades_spot" : "trades_fut", "unavailable", "stream cerrado · reintentando");
      schedule();
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    };
  };

  const schedule = () => {
    if (closed) return;
    attempts++;
    setTimeout(open, Math.min(15_000, 1500 * attempts));
  };

  open();
  return () => {
    closed = true;
    try {
      ws?.close();
    } catch {
      /* noop */
    }
  };
}

/** Arranca ambos streams; devuelve función de cierre */
export function connectTradeStreams(): () => void {
  const c1 = connect("wss://stream.binance.com:9443/ws/btcusdt@aggTrade", "spot");
  const c2 = connect("wss://fstream.binance.com/ws/btcusdt@aggTrade", "fut");
  return () => {
    c1();
    c2();
  };
}
