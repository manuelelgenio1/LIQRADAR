/* ============================================================
   Libro de órdenes L2 de futuros — snapshot REST + diff-depth
   secuencial (verificación U/u/pu y resync automático).
   Mantiene un libro local verificado, expone agregados y
   conserva frames para la historia de profundidad.
   ============================================================ */

import { markSource, safeNum } from "./dataTruth";

export interface BookLevel {
  p: number;
  q: number;
}

export interface L2Frame {
  t: number;
  bids: BookLevel[]; // top 12, descendente
  asks: BookLevel[]; // top 12, ascendente
  bidTotal: number; // USDT en top 12
  askTotal: number;
}

export interface Wall {
  price: number;
  notional: number;
  side: "bid" | "ask";
  ratio: number;
}

export interface L2State {
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  bidTotal: number;
  askTotal: number;
  imbalance: number; // 0..1 (>0.5 presión compradora)
  bids: BookLevel[];
  asks: BookLevel[];
  walls: Wall[];
  frames: L2Frame[]; // historia (más reciente al final)
  seqOk: boolean;
  resyncs: number;
  lastUpdate: number;
}

const FUT = "https://fapi.binance.com";
const WS_URL = "wss://fstream.binance.com/ws/btcusdt@depth@500ms";
const TOP = 12;
const FRAMES_CAP = 480; // ~4 min a 500ms… guardamos cada 2s → ~16 min
const FRAME_EVERY = 2000;

interface DepthEvent {
  u?: number; // último id de evento
  U?: number; // primer id de evento
  pu?: number; // u del evento previo
  b?: [string, string][];
  a?: [string, string][];
}

interface Snapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

function detectWalls(bids: BookLevel[], asks: BookLevel[]): Wall[] {
  const all = [...bids.map((l) => ({ ...l, side: "bid" as const })), ...asks.map((l) => ({ ...l, side: "ask" as const }))];
  const notionals = all.map((l) => l.p * l.q).sort((a, b) => a - b);
  const median = notionals[Math.floor(notionals.length / 2)] || 1;
  return all
    .map((l) => ({ price: l.p, notional: l.p * l.q, side: l.side, ratio: (l.p * l.q) / median }))
    .filter((w) => w.ratio >= 3)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 4);
}

export function connectL2(onState: (s: L2State) => void): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let bids = new Map<number, number>();
  let asks = new Map<number, number>();
  let lastU = 0;
  let synced = false;
  let resyncs = 0;
  let lastFrameAt = 0;
  let frames: L2Frame[] = [];
  let pending: DepthEvent[] = [];
  let attempts = 0;

  const emit = () => {
    const bidArr = Array.from(bids.entries())
      .filter(([, q]) => q > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, TOP)
      .map(([p, q]) => ({ p, q }));
    const askArr = Array.from(asks.entries())
      .filter(([, q]) => q > 0)
      .sort((a, b) => a[0] - b[0])
      .slice(0, TOP)
      .map(([p, q]) => ({ p, q }));
    const bestBid = bidArr[0]?.p ?? 0;
    const bestAsk = askArr[0]?.p ?? 0;
    const bidTotal = bidArr.reduce((a, l) => a + l.p * l.q, 0);
    const askTotal = askArr.reduce((a, l) => a + l.p * l.q, 0);
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;

    const now = Date.now();
    if (now - lastFrameAt >= FRAME_EVERY) {
      lastFrameAt = now;
      frames.push({ t: now, bids: bidArr, asks: askArr, bidTotal, askTotal });
      if (frames.length > FRAMES_CAP) frames.shift();
    }

    onState({
      mid,
      bestBid,
      bestAsk,
      spreadBps: bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / bestBid) * 10_000 : 0,
      bidTotal,
      askTotal,
      imbalance: bidTotal / (bidTotal + askTotal + 1e-9),
      bids: bidArr,
      asks: askArr,
      walls: detectWalls(bidArr, askArr),
      frames: frames.slice(),
      seqOk: synced,
      resyncs,
      lastUpdate: now,
    });
    markSource("libro", "real", synced ? undefined : "resincronizando secuencia");
  };

  const snapshot = async () => {
    synced = false;
    const res = await fetch(`${FUT}/fapi/v1/depth?symbol=BTCUSDT&limit=500`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = (await res.json()) as Snapshot;
    bids = new Map(snap.bids.map(([p, q]) => [safeNum(p), safeNum(q)]));
    asks = new Map(snap.asks.map(([p, q]) => [safeNum(p), safeNum(q)]));
    lastU = snap.lastUpdateId;
    // aplica eventos pendientes que encajen tras el snapshot
    for (const ev of pending) {
      if (typeof ev.u !== "number") continue;
      if (ev.u <= lastU) continue;
      if (typeof ev.U === "number" && ev.U > lastU + 1) continue; // hueco → esperar otro snapshot
      apply(ev);
      lastU = ev.u;
      synced = true;
    }
    pending = [];
    emit();
  };

  const apply = (ev: DepthEvent) => {
    for (const [ps, qs] of ev.b ?? []) {
      const p = safeNum(ps);
      const q = safeNum(qs);
      if (p <= 0) continue;
      if (q === 0) bids.delete(p);
      else bids.set(p, q);
    }
    for (const [ps, qs] of ev.a ?? []) {
      const p = safeNum(ps);
      const q = safeNum(qs);
      if (p <= 0) continue;
      if (q === 0) asks.delete(p);
      else asks.set(p, q);
    }
  };

  const onMsg = (raw: string) => {
    let ev: DepthEvent;
    try {
      ev = JSON.parse(raw) as DepthEvent;
    } catch {
      return;
    }
    if (typeof ev.u !== "number") return;
    if (!synced) {
      pending.push(ev);
      if (pending.length > 400) pending.shift();
      return;
    }
    // verificación de secuencia: pu debe coincidir con el u previo (primer evento tras snapshot se valida en snapshot())
    if (typeof ev.pu === "number" && ev.pu !== lastU) {
      resyncs++;
      void snapshot();
      return;
    }
    apply(ev);
    lastU = ev.u;
    emit();
  };

  const open = () => {
    if (closed) return;
    markSource("libro", "connecting");
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      schedule();
      return;
    }
    ws.onmessage = (e) => onMsg(String(e.data));
    ws.onopen = () => {
      attempts = 0;
      void snapshot();
    };
    ws.onclose = () => {
      markSource("libro", "unavailable", "stream cerrado · reintentando");
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

  void snapshot().then(open).catch(() => schedule());

  return () => {
    closed = true;
    try {
      ws?.close();
    } catch {
      /* noop */
    }
  };
}
