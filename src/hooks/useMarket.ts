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
import { logAudit } from "../lib/auditLog";
import { connectTradeStreams, getSpotCvd, getFutCvd, type CvdState } from "../lib/streams";
import { connectL2, type L2State } from "../lib/l2";
import { computeMicro, type MicroState } from "../lib/microstructure";
import { fetchPositionFlow, type PositionFlow } from "../lib/positionFlow";
import { fetchOptionsAdvanced, type OptionsAdvanced } from "../lib/options";
import { markSource } from "../lib/dataTruth";

export type Timeframe = "15m" | "1h" | "4h" | "1d" | "1w";

export const TF_CONFIG: Record<
  Timeframe,
  { interval: string; limit: number; ms: number; range: number; label: string; lookback: number; desc: string; winH: number }
> = {
  "15m": { interval: "15m", limit: 96, ms: 900_000, range: 0.008, label: "15M", lookback: 20, desc: "scalping", winH: 48 },
  "1h": { interval: "1h", limit: 120, ms: 3_600_000, range: 0.016, label: "1H", lookback: 22, desc: "intradía", winH: 96 },
  "4h": { interval: "4h", limit: 96, ms: 14_400_000, range: 0.035, label: "4H", lookback: 24, desc: "swing", winH: 240 },
  "1d": { interval: "1d", limit: 90, ms: 86_400_000, range: 0.07, label: "1D", lookback: 26, desc: "posición", winH: 720 },
  "1w": { interval: "1w", limit: 52, ms: 604_800_000, range: 0.15, label: "1W", lookback: 26, desc: "macro", winH: 2160 },
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
  /* ---------- datos REALES V5 ---------- */
  spotCvd: CvdState; // CVD real spot (aggTrade)
  futCvd: CvdState; // CVD real futuros (aggTrade)
  l2: L2State | null; // libro L2 secuenciado
  micro: MicroState | null; // absorción + riesgo spoof
  posFlow: PositionFlow | null; // Top-Trader Position Flow
  optAdv: OptionsAdvanced | null; // IV/skew/Max Pain
  candles: Candle[];
  daily: Candle[];
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
  const emptyCvd: CvdState = { cvd1m: 0, cvd5m: 0, cvd15m: 0, pct5m: 0, pct15m: 0, net: 0, trades: 0, lastAt: 0 };
  const [spotCvd, setSpotCvd] = useState<CvdState>(emptyCvd);
  const [futCvd, setFutCvd] = useState<CvdState>(emptyCvd);
  const [l2, setL2] = useState<L2State | null>(null);
  const [micro, setMicro] = useState<MicroState | null>(null);
  const [posFlow, setPosFlow] = useState<PositionFlow | null>(null);
  const [optAdv, setOptAdv] = useState<OptionsAdvanced | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [daily, setDaily] = useState<Candle[]>([]);
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
        logAudit("datos", "warn", `Velas ${cfg.interval} no disponibles en Binance → usando simulador coherente`);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cfg.interval, cfg.limit, cfg.ms]);

  /* ---------- velas diarias (niveles clave: apertura diaria/semanal, máx/mín día anterior) ---------- */
  useEffect(() => {
    let alive = true;
    fetchKlines("1d", 9)
      .then((d) => {
        if (alive && d.length > 0) setDaily(d);
      })
      .catch(() => {
        /* los niveles son opcionales si no hay red */
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ---------- trades REALES (aggTrade spot + futuros) → CVD observado ---------- */
  useEffect(() => {
    const close = connectTradeStreams();
    const id = setInterval(() => {
      setSpotCvd(getSpotCvd());
      setFutCvd(getFutCvd());
    }, 2000);
    return () => {
      clearInterval(id);
      close();
    };
  }, []);

  /* ---------- libro L2 secuenciado + microestructura ---------- */
  useEffect(() => {
    const close = connectL2((s) => {
      setL2(s);
      setMicro(computeMicro(s.frames, getSpotCvd(), getFutCvd(), 0.3));
    });
    return () => {
      close();
    };
  }, []);

  /* ---------- Top-Trader flow + opciones avanzadas (cada 5 min) ---------- */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const pf = await fetchPositionFlow();
        if (alive) {
          setPosFlow(pf);
          markSource("topflow", "real");
        }
      } catch {
        if (alive) markSource("topflow", "unavailable");
      }
      try {
        const oa = await fetchOptionsAdvanced();
        if (alive) {
          setOptAdv(oa);
          markSource("opciones", oa.atmIv !== null || oa.skew !== null || oa.maxPain !== null ? "real" : "unavailable", oa.note);
        }
      } catch {
        if (alive) markSource("opciones", "unavailable");
      }
    };
    load();
    const id = setInterval(load, 300_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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
    spotCvd,
    futCvd,
    l2,
    micro,
    posFlow,
    optAdv,
    candles,
    daily,
    oiHistory,
    liqEvents,
    sessionLong: session.long,
    sessionShort: session.short,
    sources,
    refreshIn,
  };
}
