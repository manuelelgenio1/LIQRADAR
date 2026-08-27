import { useEffect, useMemo, useRef, useState } from "react";
import { useMarket, TF_CONFIG, type Timeframe } from "./hooks/useMarket";
import { useConfluence } from "./hooks/useConfluence";
import { useReveal } from "./hooks/useReveal";
import { estimateLiquidationMap, computeVerdict, atrOf, computeCvd, fundingProximity, detectSweep, liqVelocityScore } from "./lib/engine";
import {
  evaluatePredictions,
  loadPredictions,
  savePredictions,
  shouldRecord,
  toPrediction,
  type Prediction,
} from "./lib/history";
import { TopBar } from "./components/TopBar";
import { PriceChart } from "./components/PriceChart";
import { KeyLevelsPanel } from "./components/KeyLevelsPanel";
import { computeKeyLevels } from "./lib/levels";
import { LiquidationMap } from "./components/LiquidationMap";
import { PredictionPanel } from "./components/PredictionPanel";
import { FeedPanel } from "./components/FeedPanel";
import { AccumulationPanel } from "./components/AccumulationPanel";
import { TrackRecord } from "./components/TrackRecord";
import { BacktestLab } from "./components/BacktestLab";
import { RumboGauge } from "./components/RumboGauge";
import { RegimeBadge } from "./components/RegimeBadge";
import { SessionsStrip } from "./components/SessionsStrip";
import { LiqHeatmap } from "./components/LiqHeatmap";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { FlipAlert, type FlipInfo } from "./components/FlipAlert";
import type { BiasPoint } from "./components/RumboGauge";
import { loadSoundPref, playConfirm, playFlip, playMagnet, playSniper, saveSoundPref } from "./lib/sound";
import { MarketPulsePanel } from "./components/MarketPulsePanel";
import { BenchmarkPanel } from "./components/BenchmarkPanel";
import { ConfluencePanel } from "./components/ConfluencePanel";
import { ExchangeRadarPanel } from "./components/ExchangeRadarPanel";
import { FundingHeatmap } from "./components/FundingHeatmap";
import { AgentBridgePanel } from "./components/AgentBridgePanel";
import { SectionGroup } from "./components/SectionGroup";
import { MiniNav, type ZoneDef } from "./components/MiniNav";
import { AlertCenter, type SniperCfg, type PriceLevel } from "./components/AlertCenter";
import { SniperToast, type SniperInfo } from "./components/SniperToast";
import { LevelToast, type LevelHit } from "./components/LevelToast";
import { RiskPanel } from "./components/RiskPanel";
import { Journal } from "./components/Journal";
import { OnboardingTour } from "./components/OnboardingTour";
import { loadCalibration, loadHitRate, saveHitRate, type Calibration } from "./lib/calibration";
import { OrderBookPanel } from "./components/OrderBookPanel";

const STEPS = [
  {
    n: "01",
    title: "Lee los pools, no el precio",
    body: "Las barras verdes bajo el spot son liquidaciones de longs; las rojas arriba, de shorts. Cuanto más grueso el cluster, más fuerte el imán: el mercado suele viajar a barrerlos antes de girar.",
  },
  {
    n: "02",
    title: "Detecta la multitud",
    body: "Funding positivo + ratio de cuentas > 1 = todo el mundo en long. Esa multitud solo gana si el precio no cae: su combustible está apilado justo debajo, listo para ser cazado.",
  },
  {
    n: "03",
    title: "Espera el sweep",
    body: "Cuando el precio atraviesa un cluster y la cinta de liquidaciones se enciende, el movimiento suele agotarse ahí: la liquidez ya fue tomada y los liquidados son la contrapartida del giro.",
  },
  {
    n: "04",
    title: "Invalida sin piedad",
    body: "Cada veredicto tiene un nivel de invalidación (el gran cluster contrario). Si el precio lo barre con volumen, el escenario muere y el sesgo se voltea: recalcular, no insistir.",
  },
  {
    n: "05",
    title: "Audita al propio radar",
    body: "El panel de historial registra cada veredicto y lo verifica contra el precio real. Si la tasa de acierto cae en el timeframe que usas, cambia de ventana o exige más factores alineados antes de actuar.",
  },
];

/* Las 5 zonas del terminal (agrupan los paneles para no abrumar) */
const ZONES: ZoneDef[] = [
  { id: "zona-decision", label: "⌖ Decisión", accent: "#2fd6a5" },
  { id: "zona-mapa", label: "▦ Mapa", accent: "#3fb6ff" },
  { id: "zona-datos", label: "⛁ Datos", accent: "#e05cd0" },
  { id: "zona-operativa", label: "⚖ Operativa", accent: "#ffb547" },
  { id: "zona-validacion", label: "⚗ Validación", accent: "#ff4d6d" },
];

export default function App() {
  const [tf, setTf] = useState<Timeframe>("72h");
  const [levs, setLevs] = useState<number[]>([10, 25, 50, 100]);
  const [tourOpen, setTourOpen] = useState(false);
  const market = useMarket(tf);
  const confluence = useConfluence();

  // redondeo del spot para no recalcular el mapa en cada tick
  const roundedSpot = useMemo(() => Math.round(market.spot / 8) * 8, [market.spot]);

  // calibración de pesos aplicada desde el laboratorio (se recalcula al volver de la pestaña)
  const [calibration, setCalibration] = useState<Calibration | null>(() => loadCalibration());
  useEffect(() => {
    const reload = () => setCalibration(loadCalibration());
    window.addEventListener("focus", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  const onCalibrated = (c: Calibration) => setCalibration(c);

  // tasa de acierto histórica persistida por el laboratorio (para el índice de confiabilidad)
  const [hitRate, setHitRate] = useState<{ hitRate: number; samples: number } | null>(() => {
    const h = loadHitRate();
    return h ? { hitRate: h.hitRate, samples: h.samples } : null;
  });
  const onHitRate = (hr: number, samples: number) => {
    setHitRate({ hitRate: hr, samples });
    saveHitRate(hr, samples);
  };

  // niveles clave de estructura (objetivos, derivados de velas diarias + visibles)
  const keyLevels = useMemo(
    () => computeKeyLevels(market.daily, market.candles, market.spot),
    [market.daily, market.candles, market.spot]
  );

  const analysis = useMemo(() => {
    if (market.candles.length === 0) return null;
    const cfg = TF_CONFIG[tf];
    const cvd = computeCvd(market.candles);
    const oiUsdt = market.oi > 0 ? market.oi * roundedSpot : 0;
    const { bins, longPool, shortPool, nearLongPool, nearShortPool, clusters } = estimateLiquidationMap(
      market.candles,
      roundedSpot,
      levs,
      cfg.range,
      58,
      oiUsdt,
      2
    );
    const atrPerHour = atrOf(market.candles) * (3600_000 / cfg.ms);

    // pendientes multi-plazo: tercio reciente vs ventana completa
    const n = market.candles.length;
    const last = market.candles[n - 1].close;
    const k = Math.max(2, Math.floor(n / 3));
    const fastSlopePct = ((last - market.candles[n - 1 - k].close) / market.candles[n - 1 - k].close) * 100;
    const slowSlopePct = ((last - market.candles[0].close) / market.candles[0].close) * 100;

    // impulso de las últimas 4 velas (en unidades de ATR de vela)
    const momBase = market.candles[Math.max(0, n - 5)];
    const momPct = momBase.close > 0 ? ((last - momBase.close) / momBase.close) * 100 : 0;

    const verdict = computeVerdict({
      spot: roundedSpot,
      longPool,
      shortPool,
      nearLongPool,
      nearShortPool,
      clusters,
      fundingRate: market.fundingRate,
      fundingTrend: market.fundingTrend,
      globalRatio: market.globalRatio,
      topRatio: market.topRatio,
      takerRatio: market.takerRatio,
      oiChange24h: market.oiChange24h,
      oiSlope5m: market.oiSlope5m,
      priceChange24h: market.change24h,
      premium: market.premium,
      atr1h: atrPerHour,
      liveLongLiq: market.sessionLong,
      liveShortLiq: market.sessionShort,
      cvdPct: cvd.cvdPct,
      cvdDiv: cvd.divergence,
      oiUsdt,
      fastSlopePct,
      slowSlopePct,
      momPct,
      bookImbalance: market.bookImbalance,
      xCfundingGap: market.xCfundingGap,
      fundingWindow: fundingProximity(Date.now()),
      sweep: detectSweep(market.candles, clusters),
      liqVelocity: liqVelocityScore(market.liqEvents, Date.now()),
      weights: calibration?.weights,
    });
    return { bins, longPool, shortPool, clusters, cvd, verdict, updatedAt: Date.now() };
  }, [market.candles, market.liqEvents, market.bookImbalance, market.xCfundingGap, market.oi, market.fundingRate, market.fundingTrend, market.globalRatio, market.topRatio, market.takerRatio, market.oiChange24h, market.oiSlope5m, market.premium, market.change24h, market.sessionLong, market.sessionShort, roundedSpot, tf, levs, calibration]);

  /* ---------- track record del modelo ---------- */
  const [preds, setPreds] = useState<Prediction[]>(() => loadPredictions());
  const predsRef = useRef(preds);
  predsRef.current = preds;
  const lastPredRef = useRef<Prediction | null>(preds[0] ?? null);

  // registra cada veredicto con sesgo (con deduplicación por escenario)
  useEffect(() => {
    if (!analysis) return;
    const now = Date.now();
    if (shouldRecord(analysis.verdict, roundedSpot, lastPredRef.current, now)) {
      const p = toPrediction(analysis.verdict, roundedSpot, now);
      lastPredRef.current = p;
      const next = [p, ...predsRef.current].slice(0, 40);
      savePredictions(next);
      setPreds(next);
    }
  }, [analysis, roundedSpot]);

  // evalúa las predicciones abiertas contra el precio en vivo
  useEffect(() => {
    const { list, changed } = evaluatePredictions(preds, roundedSpot, Date.now());
    if (changed) {
      savePredictions(list);
      setPreds(list);
    }
  }, [preds, roundedSpot]);

  /* ---------- alerta de cambio de rumbo LONG ↔ SHORT ---------- */
  const [flip, setFlip] = useState<FlipInfo | null>(null);
  const [flipCount, setFlipCount] = useState(0);
  const prevDirRef = useRef<string | null>(null);
  useEffect(() => {
    if (!analysis) return;
    const dir = analysis.verdict.direction;
    const prev = prevDirRef.current;
    if (prev !== null && prev !== dir && dir !== "neutral" && prev !== "neutral") {
      setFlip({
        dir: dir as "up" | "down",
        at: Date.now(),
        spot: roundedSpot,
        target: analysis.verdict.target?.price ?? null,
      });
      setFlipCount((c) => c + 1);
    }
    prevDirRef.current = dir;
  }, [analysis, roundedSpot]);

  /* ---------- historial de sesgo (sparkline del rumbo) ---------- */
  const [biasHist, setBiasHist] = useState<BiasPoint[]>([]);
  const lastBiasRef = useRef(0);
  useEffect(() => {
    if (!analysis) return;
    const now = Date.now();
    const s = analysis.verdict.scorePct;
    const last = biasHist[biasHist.length - 1];
    // una lectura cada ≥4s, o antes si el sesgo saltó ≥6 puntos
    if (now - lastBiasRef.current >= 4000 || !last || Math.abs(s - last.score) >= 6) {
      lastBiasRef.current = now;
      setBiasHist((h) => [...h.slice(-179), { t: now, score: s }]);
    }
  }, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- alertas sonoras ---------- */
  const [soundOn, setSoundOn] = useState<boolean>(() => loadSoundPref());
  const toggleSound = () => {
    setSoundOn((on) => {
      saveSoundPref(!on);
      if (!on) playMagnet(); // confirmación audible al activar
      return !on;
    });
  };
  useEffect(() => {
    if (!flip) return;
    if (soundOn) playFlip(flip.dir);
    sendWebhook("giro_rumbo", {
      rumbo: flip.dir === "up" ? "LONG" : "SHORT",
      spot: flip.spot,
      objetivo: flip.target,
    });
  }, [flip, soundOn]);

  // zona magnética: precio cerca del imán objetivo (≤0.6% o dentro de 1 ATR)
  const magnetClose =
    !!analysis?.verdict.target &&
    (analysis.verdict.cascade.length > 0 || analysis.verdict.target.distancePct <= 0.6);
  const prevMagnetRef = useRef(false);
  useEffect(() => {
    if (magnetClose && !prevMagnetRef.current) {
      if (soundOn) playMagnet();
      sendWebhook("zona_magnetica", { spot: roundedSpot });
    }
    prevMagnetRef.current = magnetClose;
  }, [magnetClose, soundOn, roundedSpot]);

  /* ---------- modo francotirador + webhook ---------- */
  const [sniper, setSniperState] = useState<SniperCfg>(() => {
    try {
      const raw = localStorage.getItem("liqradar-sniper-v1");
      if (raw) return { on: false, biasTh: 60, confTh: 60, ...(JSON.parse(raw) as Partial<SniperCfg>) };
    } catch {
      /* noop */
    }
    return { on: false, biasTh: 60, confTh: 60 };
  });
  const setSniper = (s: SniperCfg) => {
    setSniperState(s);
    try {
      localStorage.setItem("liqradar-sniper-v1", JSON.stringify(s));
    } catch {
      /* noop */
    }
  };
  const [webhook, setWebhookState] = useState<string>(() => {
    try {
      return localStorage.getItem("liqradar-webhook-v1") ?? "";
    } catch {
      return "";
    }
  });
  const setWebhook = (u: string) => {
    setWebhookState(u);
    try {
      localStorage.setItem("liqradar-webhook-v1", u);
    } catch {
      /* noop */
    }
  };
  const webhookRef = useRef(webhook);
  webhookRef.current = webhook;

  const sendWebhook = (evento: string, extra: Record<string, unknown>) => {
    const url = webhookRef.current.trim();
    if (!url) return;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: "LiqRadar", evento, ...extra, ts: new Date().toISOString() }),
    }).catch(() => {
      /* webhook inaccesible: no bloquea el radar */
    });
  };

  const [sniperAlert, setSniperAlert] = useState<SniperInfo | null>(null);
  const [lastFire, setLastFire] = useState<number | null>(null);
  const lastSniperRef = useRef(0);

  /* ---------- alertas por nivel de precio ---------- */
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>(() => {
    try {
      const raw = localStorage.getItem("liqradar-levels-v1");
      if (raw) return JSON.parse(raw) as PriceLevel[];
    } catch {
      /* noop */
    }
    return [];
  });
  const [levelHit, setLevelHit] = useState<LevelHit | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("liqradar-levels-v1", JSON.stringify(priceLevels));
    } catch {
      /* noop */
    }
  }, [priceLevels]);

  const addLevel = (price: number) => {
    setPriceLevels((ls) => [
      ...ls.filter((l) => Math.abs(l.price - price) / price > 0.0005),
      { id: `${Date.now()}-${Math.round(price)}`, price, side: price >= market.spot ? "arriba" : "abajo", fired: false, createdAt: Date.now() },
    ]);
  };
  const removeLevel = (id: string) => setPriceLevels((ls) => ls.filter((l) => l.id !== id));

  useEffect(() => {
    const spot = market.spot;
    if (!Number.isFinite(spot) || spot <= 0) return;
    for (const l of priceLevels) {
      if (l.fired) continue;
      const hit = (l.side === "arriba" && spot >= l.price) || (l.side === "abajo" && spot <= l.price);
      if (hit) {
        setPriceLevels((ls) => ls.map((x) => (x.id === l.id ? { ...x, fired: true } : x)));
        setLevelHit({ id: l.id, price: l.price, side: l.side, spot });
        setLastFire(Date.now());
        if (soundOn) playMagnet();
        sendWebhook("nivel_precio", {
          nivel: l.price,
          lado: l.side,
          spot,
          mensaje: `BTC ${l.side === "arriba" ? "superó" : "perdió"} el nivel $${Math.round(l.price).toLocaleString("en-US")}`,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.spot, priceLevels, soundOn]);

  useEffect(() => {
    if (!analysis || !sniper.on) return;
    const v = analysis.verdict;
    if (v.direction === "neutral") return;
    if (Math.abs(v.scorePct) >= sniper.biasTh && v.confidence >= sniper.confTh) {
      const now = Date.now();
      if (now - lastSniperRef.current > 45_000) {
        lastSniperRef.current = now;
        setSniperAlert({
          dir: v.direction,
          at: now,
          spot: roundedSpot,
          target: v.target?.price ?? null,
          confidence: v.confidence,
          score: v.scorePct,
        });
        setLastFire(now);
        if (soundOn) playSniper();
        sendWebhook("senal_francotirador", {
          rumbo: v.direction === "up" ? "LONG" : "SHORT",
          sesgo: v.scorePct,
          confianza: v.confidence,
          spot: roundedSpot,
          objetivo: v.target?.price ?? null,
        });
      }
    }
  }, [analysis, sniper, roundedSpot, soundOn]);

  const testAlerts = () => {
    if (soundOn) playConfirm();
    sendWebhook("prueba", { mensaje: "LiqRadar conectado: recibirás giros de rumbo, zonas magnéticas y señales francotirador" });
  };

  // índice de confiabilidad de la señal: confianza del modelo + acierto histórico +
  // frescura de datos + confluencia multi-timeframe (coincidir con el rumbo suma)
  const reliability = useMemo(() => {
    if (!analysis) return null;
    const conf = analysis.verdict.confidence;
    const hist = hitRate ? hitRate.hitRate : 50; // sin laboratorio corrido → neutro
    const src = market.sources;
    const liveCount = [src.klines, src.metrics, src.price, src.liq].filter((s) => s === "live").length;
    const freshness = liveCount === 4 ? 100 : liveCount >= 2 ? 60 : 30;

    // confluencia: si los timeframes cargaron y hay acuerdo, aporta; si además el
    // acuerdo apunta en la MISMA dirección que el veredicto, aporta el máximo
    let mtf = 50;
    if (!confluence.loading && !confluence.sim) {
      if (confluence.alignedDir === "mixed" || confluence.alignedDir === null) {
        mtf = 40; // sin acuerdo → pequeña penalización
      } else if (confluence.alignedDir === analysis.verdict.direction) {
        mtf = 50 + confluence.grade * 0.5; // hasta 100 si 3/3 alineados con el rumbo
      } else {
        mtf = Math.max(0, 50 - confluence.grade * 0.5); // acuerdo en contra → penaliza
      }
    }

    return Math.round(0.4 * conf + 0.2 * hist + 0.15 * freshness + 0.25 * mtf);
  }, [analysis, hitRate, market.sources, confluence]);

  const r0 = useReveal();
  const r1 = useReveal();
  const r2 = useReveal();
  const r3 = useReveal();
  const r4 = useReveal();
  const r5 = useReveal();
  const r6 = useReveal();
  const r7 = useReveal();
  const r8 = useReveal();
  const r9 = useReveal();
  const r10 = useReveal();
  const r11 = useReveal();
  const r12 = useReveal();
  const r13 = useReveal();
  const r14 = useReveal();
  const r15 = useReveal();
  const r16 = useReveal();
  const r17 = useReveal();
  const r18 = useReveal();

  /* badges de estado para las cabeceras de zona */
  const vDir = analysis?.verdict.direction;
  const dirColor = vDir === "up" ? "#2fd6a5" : vDir === "down" ? "#ff4d6d" : "#ffb547";
  const dirWord = vDir === "up" ? "LONG" : vDir === "down" ? "SHORT" : "NEUTRO";
  const verdictChip = analysis ? (
    <span
      className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] font-700 tracking-widest"
      style={{ color: dirColor, borderColor: `${dirColor}55`, background: `${dirColor}12` }}
    >
      <span className="live-dot" style={{ background: dirColor, color: dirColor, width: 6, height: 6 }} />
      {dirWord}
    </span>
  ) : undefined;
  const hitChip = hitRate ? (
    <span className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-mist">
      <b className="text-fog">{Math.round(hitRate.hitRate)}%</b> acierto · {hitRate.samples} pruebas
    </span>
  ) : undefined;

  return (
    <div className="relative min-h-screen font-body">
      <div className="ambient" />
      <div className="scanline" />

      <FlipAlert flip={flip} onDismiss={() => setFlip(null)} />
      <SniperToast s={sniperAlert} onDismiss={() => setSniperAlert(null)} />
      <LevelToast hit={levelHit} onDismiss={() => setLevelHit(null)} />
      <OnboardingTour forceOpen={tourOpen} onCloseRequest={() => setTourOpen(false)} />

      <div className="relative z-10">
        <TopBar m={market} soundOn={soundOn} onToggleSound={toggleSound} />
        <SessionsStrip />
        <MiniNav zones={ZONES} />

        <main className="mx-auto max-w-[1500px] px-5 pb-16 pt-6">
          {/* ══ Z1 · DECISIÓN ══ */}
          <SectionGroup
            id="zona-decision"
            num="Z1"
            title="Decisión"
            subtitle="rumbo LONG/SHORT · volatilidad · confluencia multi-plazo · alertas"
            accent="#2fd6a5"
            defaultOpen
            badge={verdictChip}
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12.5 5.5 10 10l-4.5 2.5L8 8l4.5-2.5Z" fill="currentColor" />
              </svg>
            }
          >
          {/* rumbo: ¿LONG o SHORT? */}
          <section className="reveal mb-5" ref={r0}>
            {analysis ? (
              <RumboGauge
                v={analysis.verdict}
                spot={market.spot}
                history={biasHist}
                magnetClose={magnetClose}
                magnetPrice={analysis.verdict.target?.price ?? null}
                reliability={reliability}
              />
            ) : (
              <div className="panel flex h-40 animate-pulse items-center justify-center font-mono text-xs text-dusk">
                FIJANDO RUMBO…
              </div>
            )}
          </section>

          {/* régimen de volatilidad */}
          <section className="reveal mb-5" ref={r14}>
            {analysis ? (
              <RegimeBadge regime={analysis.verdict.regime} />
            ) : (
              <div className="flex h-14 animate-pulse items-center justify-center rounded-lg border border-line/50 font-mono text-xs text-dusk">
                MIDIENDO VOLATILIDAD…
              </div>
            )}
          </section>

          {/* confluencia multi-timeframe */}
          <section className="panel reveal mb-5" ref={r13}>
            <ConfluencePanel spot={market.spot} confluence={confluence} />
          </section>

          {/* centro de alertas */}
          <section className="reveal mb-5" ref={r9}>
            <AlertCenter
              sniper={sniper}
              onSniper={setSniper}
              webhook={webhook}
              onWebhook={setWebhook}
              onTest={testAlerts}
              lastFire={lastFire}
              spot={market.spot}
              levels={priceLevels}
              onAddLevel={addLevel}
              onRemoveLevel={removeLevel}
            />
          </section>

          {/* puente a Binance Agent OS */}
          <section className="panel reveal mb-5" ref={r18}>
            {analysis && (
              <AgentBridgePanel
                verdict={analysis.verdict}
                spot={market.spot}
                longPool={analysis.longPool}
                shortPool={analysis.shortPool}
                confluence={confluence}
              />
            )}
          </section>
          </SectionGroup>

          {/* ══ Z2 · MAPA DEL MERCADO ══ */}
          <SectionGroup
            id="zona-mapa"
            num="Z2"
            title="Mapa del mercado"
            subtitle="gráfico · niveles clave · mapa de liquidación · motor · heatmap 2D"
            accent="#3fb6ff"
            defaultOpen
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="10" y="10" width="6" height="6" rx="1" fill="currentColor" />
              </svg>
            }
          >
          {/* fila principal */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* columna izquierda */}
            <div className="order-2 flex flex-col gap-5 lg:order-1">
              <section className="panel p-5">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="panel-tag">M1 · contexto</div>
                    <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
                      BTC/USDT · velas {TF_CONFIG[tf].label} <span className="text-mist">({TF_CONFIG[tf].desc})</span> · footprint + OI
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px] tabular-nums text-dusk">
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />precio spot</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-short" />liq. shorts (objetivo alcista)</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-long" />liq. longs (objetivo bajista)</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-pulse" />OI (azul)</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-fog" />delta y Δ acumulado (footprint)</span>
                  </div>
                </div>
                {market.candles.length > 0 ? (
                  <PriceChart
                    candles={market.candles}
                    clusters={analysis?.clusters ?? []}
                    spot={market.spot}
                    oiHistory={market.oiHistory}
                    levels={keyLevels.filter((l) => ["PDH", "PDL", "DO", "WO"].includes(l.short)).map((l) => ({ price: l.price, label: l.label }))}
                  />
                ) : (
                  <div className="flex h-[340px] animate-pulse items-center justify-center rounded-md border border-line/50 font-mono text-xs text-dusk sm:h-[400px]">
                    CARGANDO VELAS…
                  </div>
                )}
              </section>

              <section className="panel reveal" ref={r15}>
                <KeyLevelsPanel levels={keyLevels} spot={market.spot} />
              </section>

              <section className="panel reveal" ref={r1}>
                {analysis && (
                  <LiquidationMap
                    bins={analysis.bins}
                    clusters={analysis.clusters}
                    spot={market.spot}
                    longPool={analysis.longPool}
                    shortPool={analysis.shortPool}
                    tf={tf}
                    onTf={setTf}
                    levs={levs}
                    onLevs={setLevs}
                  />
                )}
              </section>
            </div>

            {/* columna derecha */}
            <div className="order-1 flex flex-col gap-5 lg:order-2">
              <section className="panel">
                {analysis ? (
                  <PredictionPanel v={analysis.verdict} updatedAt={analysis.updatedAt} />
                ) : (
                  <div className="flex h-64 animate-pulse items-center justify-center font-mono text-xs text-dusk">
                    CALIBRANDO MOTOR…
                  </div>
                )}
              </section>

              <section className="panel reveal" ref={r2}>
                <FeedPanel
                  events={market.liqEvents}
                  sessionLong={market.sessionLong}
                  sessionShort={market.sessionShort}
                  live={market.sources.liq === "live"}
                />
              </section>
            </div>
          </div>

          {/* heatmap 2D tiempo × precio */}
          <section className="panel reveal mt-5" ref={r4}>
            {market.candles.length > 4 && (
              <LiqHeatmap
                candles={market.candles}
                leverages={levs}
                lookback={TF_CONFIG[tf].lookback}
                label={`ventana ${TF_CONFIG[tf].label}`}
              />
            )}
          </section>
          </SectionGroup>

          {/* ══ Z3 · DATOS DEL MERCADO ══ */}
          <SectionGroup
            id="zona-datos"
            num="Z3"
            title="Datos del mercado"
            subtitle="pulso histórico · multi-exchange · order book · funding (plegado por defecto)"
            accent="#e05cd0"
            defaultOpen={false}
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <ellipse cx="9" cy="4" rx="6.5" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2.5 4v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2.5 9c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            }
          >
          {/* pulso del mercado */}
          <section className="panel reveal" ref={r7}>
            <MarketPulsePanel />
          </section>

          {/* radar multi-exchange */}
          <section className="panel reveal mt-5" ref={r8}>
            <ExchangeRadarPanel
              spot={market.spot}
              change24h={market.change24h}
              fundingRate={market.fundingRate}
              oiBtc={market.oi}
            />
          </section>

          {/* order flow L2 */}
          <section className="panel reveal mt-5" ref={r11}>
            <OrderBookPanel spot={market.spot} />
          </section>

          {/* heatmap de funding por exchange */}
          <section className="panel reveal mt-5" ref={r17}>
            <FundingHeatmap />
          </section>
          </SectionGroup>

          {/* ══ Z4 · OPERATIVA Y RIESGO ══ */}
          <SectionGroup
            id="zona-operativa"
            num="Z4"
            title="Operativa y riesgo"
            subtitle="tamaño de posición · diario de trading (plegado por defecto)"
            accent="#ffb547"
            defaultOpen={false}
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M9 2v3M9 2 5 6m4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 6h12M4.5 6l1 9h7l1-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          >
          {/* gestión de riesgo */}
          <section className="panel reveal" ref={r12}>
            <RiskPanel
              spot={market.spot}
              target={analysis?.verdict.target?.price ?? null}
              invalidation={analysis?.verdict.invalidation?.price ?? null}
              direction={analysis?.verdict.direction ?? "neutral"}
            />
          </section>

          {/* diario de trading */}
          <section className="panel reveal mt-5" ref={r16}>
            <Journal spot={market.spot} verdict={analysis?.verdict ?? null} />
          </section>
          </SectionGroup>

          {/* ══ Z5 · VALIDACIÓN ══ */}
          <SectionGroup
            id="zona-validacion"
            num="Z5"
            title="Validación del modelo"
            subtitle="posicionamiento · historial · laboratorio · diagnóstico · benchmark (plegado por defecto)"
            accent="#ff4d6d"
            defaultOpen={false}
            badge={hitChip}
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M7 2h4M8 2v5l-4.5 8A1.5 1.5 0 0 0 4.8 17h8.4a1.5 1.5 0 0 0 1.3-2L10 7V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5.5 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
          >
          {/* acumulación + track record */}
          <div className="reveal grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_1fr]" ref={r3}>
            <section className="panel">
              {analysis && (
                <AccumulationPanel
                  v={analysis.verdict}
                  longPool={analysis.longPool}
                  shortPool={analysis.shortPool}
                  fundingRate={market.fundingRate}
                  globalRatio={market.globalRatio}
                  topRatio={market.topRatio}
                  oi={market.oi}
                  oiChange24h={market.oiChange24h}
                  change24h={market.change24h}
                  cvdPct={analysis.cvd.cvdPct}
                  cvdNet={analysis.cvd.cvdNet}
                  cvdSeries={analysis.cvd.series}
                />
              )}
            </section>
            <section className="panel">
              <TrackRecord preds={preds} spot={market.spot} />
            </section>
          </div>

          {/* laboratorio de validación */}
          <section className="panel reveal mt-5" ref={r5}>
            <BacktestLab spot={market.spot} onCalibrated={onCalibrated} onHitRate={onHitRate} />
          </section>

          {/* diagnóstico en vivo */}
          <section className="panel reveal mt-5" ref={r6}>
            <DiagnosticsPanel
              m={market}
              a={analysis}
              rangePct={TF_CONFIG[tf].range}
              preds={preds}
              flips={flipCount}
            />
          </section>

          {/* benchmark competitivo */}
          <section className="panel reveal mt-5" ref={r10}>
            <BenchmarkPanel />
          </section>
          </SectionGroup>

          {/* método + disclaimer */}
          <section className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.35fr_1fr]">
            <div>
              <div className="panel-tag">manual de campo</div>
              <h2 className="font-display mt-2 max-w-md text-2xl font-900 leading-tight tracking-tight text-fog sm:text-3xl">
                Cómo leer el radar como un liquidador
              </h2>
              <div className="mt-6 flex flex-col">
                {STEPS.map((s, i) => (
                  <div
                    key={s.n}
                    className={`group flex gap-5 py-5 ${i < STEPS.length - 1 ? "border-b border-line/50" : ""}`}
                  >
                    <span className="font-display text-3xl font-900 leading-none text-line transition-colors duration-300 group-hover:text-long sm:text-4xl">
                      {s.n}
                    </span>
                    <div>
                      <h3 className="text-[15px] font-700 text-fog transition-colors duration-300 group-hover:text-long-hi">
                        {s.title}
                      </h3>
                      <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-mist">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-warn/25 bg-warn/[0.04] p-5">
                <div className="flex items-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <path d="M9 1.8 17 15.4H1L9 1.8Z" stroke="#ffb547" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M9 7v3.6" stroke="#ffb547" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="9" cy="13" r="0.9" fill="#ffb547" />
                  </svg>
                  <span className="font-mono text-[11px] font-700 tracking-widest text-warn">AVISO IMPORTANTE</span>
                </div>
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-mist">
                  LiqRadar es una herramienta <b className="text-fog">estadística y educativa</b>. Los niveles de
                  liquidación son <b className="text-fog">estimaciones</b> construidas con velas, volumen y
                  apalancamiento típico — no datos del libro de órdenes. El veredicto es una probabilidad ponderada,
                  jamás una certeza, y <b className="text-fog">no constituye asesoría financiera</b>. Opera con gestión
                  de riesgo o no operes.
                </p>
              </div>

              <div className="rounded-lg border border-line/70 bg-ink-950/50 p-5">
                <div className="panel-tag">fuentes de datos</div>
                <ul className="mt-2.5 space-y-2 font-mono text-[11px] leading-relaxed text-mist">
                  <li><span className="text-long">▸</span> Binance Spot — velas y precio en vivo (WebSocket)</li>
                  <li><span className="text-long">▸</span> Binance USDⓈ-M — funding, interés abierto, ratios L/S</li>
                  <li><span className="text-long">▸</span> Binance Futuros — stream <span className="text-fog">!forceOrder</span> de liquidaciones</li>
                  <li><span className="text-long">▸</span> Binance Spot — libro de órdenes L2 (muros y desequilibrio)</li>
                  <li><span className="text-long">▸</span> OKX y Bybit — precio, funding y OI (su funding también entra al motor como divergencia cross-exchange)</li>
                  <li><span className="text-long">▸</span> Binance Agent OS — puente MCP para que tu agente de IA ejecute la señal (agent.binance.com/mcp/agentic)</li>
                  <li><span className="text-long">▸</span> Webhook propio — alertas francotirador hacia Telegram/Discord</li>
                  <li><span className="text-warn">▸</span> Sin conexión: simulador coherente para seguir practicando</li>
                </ul>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-line/70 bg-ink-950/50 px-5 py-3.5 font-mono text-[10.5px] text-dusk">
                <span>próxima sincronización</span>
                <span className="tabular-nums text-fog">{market.refreshIn}s</span>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-line/60 bg-ink-900/60">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-5 font-mono text-[10.5px] text-dusk">
            <span>
              <b className="text-mist">LIQRADAR</b> · radar de liquidaciones BTC · los imanes de liquidez no predicen el
              futuro, solo muestran dónde duele
            </span>
            <span className="flex items-center gap-4">
              <button
                onClick={() => setTourOpen(true)}
                className="rounded-md border border-line px-3 py-1.5 font-mono text-[10px] text-mist transition-all hover:-translate-y-0.5 hover:border-pulse/60 hover:text-pulse"
              >
                ⟳ ver tour de nuevo
              </button>
              <span>datos: Binance · estimación propia · {new Date().getFullYear()}</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
