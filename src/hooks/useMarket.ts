import { useEffect, useRef, useState } from "react";
import type { Candle, LiqEvent } from "../lib/engine";
import {
  connectWs,
  fetchBookRatio,
  fetchFunding,
  fetchFundingHistory,
  fetchKlines,
  fetchOI5mSlope,
  fetchOIHistory,
  fetchOpenInterest,
  fetchRatios,
  fetchTakerRatio,
  fetchTicker24h,
  simKlines,
  simLiqEvent,
  simTick,
  type OIPoint,
} from "../lib/binance";
import { fetchBybit, fetchOkx } from "../lib/exchanges";

export type Timeframe = "12h" | "24h" | "72h" | "7d";

export const TF_CONFIG: Record<Timeframe, { interval: string; limit: number; ms: number; range: number; label: string }> = {
  "12h": { interval: "15m", limit: 48, ms: 900_000, range: 0.022, label: "12H" },
  "24h": { interval: "30m", limit: 48, ms: 1_800_000, range: 0.035, label: "24H" },
  "72h": { interval: "1h", limit: 72, ms: 3_600_000, range: 0.062, label: "72H" },
  "7d": { interval: "4h", limit: 42, ms: 14_400_000, range: 0.115, label: "7D" },
};

export interface MarketData {
  spot: number;
  dir: 1 | -1 | 0;
  tickId: number;
  change24h: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  fundingRate: number;
  fundingTrend: number;
  nextFundingTime: number;
  oi: number;
  oiChange24h: number;
  oiSlope5m: number;
  globalRatio: number;
  topRatio: number;
  takerRatio: number;
  takerTrend: number;
  premium: number;
  bookImbalance: number; // ratio bid/ask del libro (≈1)
  xCfundingGap: number; // funding Binance − media(OKX+Bybit)
  candles: Candle[];
  oiHistory: OIPoint[];
  liqEvents: LiqEvent[];
  sessionLong: number;
  sessionShort: number;
  sources: { klines: "live" | "sim"; metrics: "live" | "sim"; price: "live" | "sim"; liq: "live" | "sim" };
  refreshIn: number;
}

const REFRESH_S = 45;

export function useMarket(tf: Timeframe): MarketData {
  const cfg = TF_CONFIG[tf];
  const [spot, setSpot] = useState(97_400);
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const [tickId, setTickId] = useState(0);
  const [ticker, setTicker] = useState({ change: 0, high: 0, low: 0, vol: 0 });
  const [funding, setFunding] = useState({ rate: 0.0001, next: 0, trend: 0, premium: 0 });
  const [oi, setOi] = useState({ oi: 0, change: 0, slope5m: 0 });
  const [ratios, setRatios] = useState({ global: 1.05, top: 0.97 });
  const [taker, setTaker] = useState({ ratio: 1, trend: 0 });
  const [bookImbalance, setBookImbalance] = useState(1);
  const [xCfundingGap, setXCfundingGap] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [oiHistory, setOiHistory] = useState<OIPoint[]>([]);
  const [liqEvents, setLiqEvents] = useState<LiqEvent[]>([]);
  const [session, setSession] = useState({ long: 0, short: 0 });
  const [sources, setSources] = useState<MarketData["sources"]>({ klines: "sim", metrics: "sim", price: "sim", liq: "sim" });
  const [refreshIn, setRefreshIn] = useState(REFRESH_S);

  const spotRef = useRef(spot);
  spotRef.current = spot;
  const simBiasRef = useRef(0.52);
  const fundingRef = useRef(funding.rate);
  fundingRef.current = funding.rate;

  /* ---------- velas según timeframe ---------- */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const k = await fetchKlines(cfg.interval, cfg.limit);
        if (!alive || k.length === 0) return;
        setCandles(k);
        setSources((s) => ({ ...s, klines: "live" }));
        setSpot(k[k.length - 1].close);
        try {
          const h = await fetchOIHistory(cfg.interval, cfg.limit);
          if (alive && h.length > 1) setOiHistory(h);
        } catch {
          /* el overlay de OI es opcional */
        }
      } catch {
        if (!alive) return;
        setCandles(simKlines(spotRef.current, cfg.limit, cfg.ms));
        setSources((s) => ({ ...s, klines: "sim" }));
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cfg.interval, cfg.limit, cfg.ms]);

  /* ---------- métricas REST ---------- */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      let ok = true;
      try {
        const t = await fetchTicker24h();
        if (alive) {
          setTicker({ change: t.priceChangePercent, high: t.highPrice, low: t.lowPrice, vol: t.quoteVolume });
          setSpot(t.lastPrice);
        }
      } catch {
        ok = false;
      }
      try {
        const f = await fetchFunding();
        const hist = await fetchFundingHistory();
        const trend = hist.length >= 2 ? hist[hist.length - 1] - hist[0] : 0;
        const premium = f.index > 0 ? (f.mark - f.index) / f.index : 0;
        if (alive) setFunding({ rate: f.rate, next: f.nextTime, trend, premium });
      } catch {
        ok = false;
        if (alive)
          setFunding({ rate: 0.00008 + (Math.random() - 0.4) * 0.0002, next: Date.now() + 4 * 3600_000, trend: 0, premium: 0 });
      }
      try {
        const o = await fetchOpenInterest();
        const slope = await fetchOI5mSlope();
        if (alive) setOi({ oi: o.oi, change: o.change24hPct, slope5m: slope });
      } catch {
        ok = false;
      }
      try {
        const r = await fetchRatios();
        if (alive) setRatios(r);
      } catch {
        ok = false;
      }
      try {
        const tk = await fetchTakerRatio();
        if (alive) setTaker({ ratio: tk.ratio, trend: tk.trend });
      } catch {
        ok = false;
      }
      // libro de órdenes (no bloquea el estado de métricas si falla)
      try {
        const br = await fetchBookRatio();
        if (alive) setBookImbalance(br);
      } catch {
        /* opcional */
      }
      // funding cross-exchange: Binance vs media(OKX+Bybit) — no bloquea si falla
      try {
        const [okx, bybit] = await Promise.allSettled([fetchOkx(), fetchBybit()]);
        const others: number[] = [];
        if (okx.status === "fulfilled") others.push(okx.value.fundingRate);
        if (bybit.status === "fulfilled") others.push(bybit.value.fundingRate);
        if (alive && others.length > 0) {
          const avgOther = others.reduce((a, b) => a + b, 0) / others.length;
          setXCfundingGap(fundingRef.current - avgOther);
        }
      } catch {
        /* opcional */
      }
      if (alive) {
        setSources((s) => ({ ...s, metrics: ok ? "live" : "sim" }));
        setRefreshIn(REFRESH_S);
      }
    };
    load();
    const id = setInterval(load, REFRESH_S * 1000);
    const tick = setInterval(() => setRefreshIn((r) => (r > 0 ? r - 1 : REFRESH_S)), 1000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  /* ---------- precio en vivo (WS trades) ---------- */
  useEffect(() => {
    let simTimer: ReturnType<typeof setInterval> | null = null;
    const close = connectWs(
      "wss://stream.binance.com:9443/ws/btcusdt@trade",
      (data) => {
        const d = data as { p: string; m: boolean };
        const p = Number(d.p);
        if (!Number.isFinite(p)) return;
        setSources((s) => (s.price === "live" ? s : { ...s, price: "live" }));
        setDir(p >= spotRef.current ? 1 : -1);
        setSpot(p);
        setTickId((t) => t + 1);
      },
      () => {
        setSources((s) => ({ ...s, price: "sim" }));
        if (!simTimer) {
          simTimer = setInterval(() => {
            const p = simTick(spotRef.current);
            setDir(p >= spotRef.current ? 1 : -1);
            setSpot(p);
            setTickId((t) => t + 1);
          }, 1400);
        }
      }
    );
    return () => {
      close();
      if (simTimer) clearInterval(simTimer);
    };
  }, []);

  /* ---------- liquidaciones en vivo (WS forceOrder) ---------- */
  useEffect(() => {
    let gotReal = false;
    let simTimer: ReturnType<typeof setTimeout> | null = null;

    const pushEvent = (e: LiqEvent) => {
      setLiqEvents((prev) => [e, ...prev].slice(0, 46));
      setSession((s) =>
        e.side === "long" ? { ...s, long: s.long + e.notional } : { ...s, short: s.short + e.notional }
      );
    };

    const startSim = () => {
      setSources((s) => ({ ...s, liq: "sim" }));
      const loop = () => {
        pushEvent(simLiqEvent(spotRef.current, simBiasRef.current));
        simTimer = setTimeout(loop, 4200 + Math.random() * 9500);
      };
      simTimer = setTimeout(loop, 1200);
    };

    const close = connectWs(
      "wss://fstream.binance.com/ws/!forceOrder@arr",
      (data) => {
        const d = data as { o?: { s: string; S: string; p: string; q: string; T: number } };
        const o = d.o;
        if (!o || !o.s.startsWith("BTC")) return;
        gotReal = true;
        setSources((s) => (s.liq === "live" ? s : { ...s, liq: "live" }));
        const price = Number(o.p);
        const qty = Number(o.q);
        pushEvent({
          id: `liq-${o.T}-${Math.random().toString(36).slice(2, 7)}`,
          time: o.T,
          side: o.S === "SELL" ? "long" : "short",
          price,
          qty,
          notional: price * qty,
        });
      },
      () => {
        if (!gotReal && !simTimer) startSim();
      }
    );

    // si en 9s no llega nada real, arranca el simulador
    const fallback = setTimeout(() => {
      if (!gotReal) startSim();
    }, 9000);

    return () => {
      close();
      clearTimeout(fallback);
      if (simTimer) clearTimeout(simTimer);
    };
  }, []);

  /* sesgo del simulador según funding (coherencia narrativa) */
  useEffect(() => {
    simBiasRef.current = funding.rate >= 0 ? 0.56 : 0.44;
  }, [funding.rate]);

  return {
    spot,
    dir,
    tickId,
    change24h: ticker.change,
    high24h: ticker.high,
    low24h: ticker.low,
    quoteVolume24h: ticker.vol,
    fundingRate: funding.rate,
    fundingTrend: funding.trend,
    nextFundingTime: funding.next,
    oi: oi.oi,
    oiChange24h: oi.change,
    oiSlope5m: oi.slope5m,
    globalRatio: ratios.global,
    topRatio: ratios.top,
    takerRatio: taker.ratio,
    takerTrend: taker.trend,
    premium: funding.premium,
    bookImbalance,
    xCfundingGap,
    candles,
    oiHistory,
    liqEvents,
    sessionLong: session.long,
    sessionShort: session.short,
    sources,
    refreshIn,
  };
}
