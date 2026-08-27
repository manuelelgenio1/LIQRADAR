import { useEffect, useMemo, useRef, useState } from "react";
import { useMarket, TF_CONFIG, type Timeframe } from "./hooks/useMarket";
import { useReveal } from "./hooks/useReveal";
import { estimateLiquidationMap, computeVerdict, atrOf, computeCvd } from "./lib/engine";
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
import { LiquidationMap } from "./components/LiquidationMap";
import { PredictionPanel } from "./components/PredictionPanel";
import { FeedPanel } from "./components/FeedPanel";
import { AccumulationPanel } from "./components/AccumulationPanel";
import { TrackRecord } from "./components/TrackRecord";
import { BacktestLab } from "./components/BacktestLab";
import { RumboGauge } from "./components/RumboGauge";
import { LiqHeatmap } from "./components/LiqHeatmap";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { FlipAlert, type FlipInfo } from "./components/FlipAlert";
import type { BiasPoint } from "./components/RumboGauge";
import { loadSoundPref, playFlip, playMagnet, saveSoundPref } from "./lib/sound";
import { MarketPulsePanel } from "./components/MarketPulsePanel";
import { BenchmarkPanel } from "./components/BenchmarkPanel";

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

export default function App() {
  const [tf, setTf] = useState<Timeframe>("72h");
  const [levs, setLevs] = useState<number[]>([10, 25, 50, 100]);
  const market = useMarket(tf);

  // redondeo del spot para no recalcular el mapa en cada tick
  const roundedSpot = useMemo(() => Math.round(market.spot / 8) * 8, [market.spot]);

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
    });
    return { bins, longPool, shortPool, clusters, cvd, verdict, updatedAt: Date.now() };
  }, [market.candles, market.oi, market.fundingRate, market.fundingTrend, market.globalRatio, market.topRatio, market.takerRatio, market.oiChange24h, market.oiSlope5m, market.premium, market.change24h, market.sessionLong, market.sessionShort, roundedSpot, tf, levs]);

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
    if (soundOn && flip) playFlip(flip.dir);
  }, [flip, soundOn]);

  // zona magnética: precio cerca del imán objetivo (≤0.6% o dentro de 1 ATR)
  const magnetClose =
    !!analysis?.verdict.target &&
    (analysis.verdict.cascade.length > 0 || analysis.verdict.target.distancePct <= 0.6);
  const prevMagnetRef = useRef(false);
  useEffect(() => {
    if (soundOn && magnetClose && !prevMagnetRef.current) playMagnet();
    prevMagnetRef.current = magnetClose;
  }, [magnetClose, soundOn]);

  const r0 = useReveal();
  const r1 = useReveal();
  const r2 = useReveal();
  const r3 = useReveal();
  const r4 = useReveal();
  const r5 = useReveal();
  const r6 = useReveal();
  const r7 = useReveal();
  const r8 = useReveal();

  return (
    <div className="relative min-h-screen font-body">
      <div className="ambient" />
      <div className="scanline" />

      <FlipAlert flip={flip} onDismiss={() => setFlip(null)} />

      <div className="relative z-10">
        <TopBar m={market} soundOn={soundOn} onToggleSound={toggleSound} />

        <main className="mx-auto max-w-[1500px] px-5 pb-16 pt-6">
          {/* rumbo: ¿LONG o SHORT? */}
          <section className="reveal mb-5" ref={r0}>
            {analysis ? (
              <RumboGauge
                v={analysis.verdict}
                history={biasHist}
                magnetClose={magnetClose}
                magnetPrice={analysis.verdict.target?.price ?? null}
              />
            ) : (
              <div className="panel flex h-40 animate-pulse items-center justify-center font-mono text-xs text-dusk">
                FIJANDO RUMBO…
              </div>
            )}
          </section>

          {/* fila principal */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* columna izquierda */}
            <div className="order-2 flex flex-col gap-5 lg:order-1">
              <section className="panel p-5">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="panel-tag">00 · contexto</div>
                    <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
                      BTC/USDT · velas {TF_CONFIG[tf].label}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px] tabular-nums text-dusk">
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />precio spot</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-short" />liq. shorts (objetivo alcista)</span>
                    <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-long" />liq. longs (objetivo bajista)</span>
                  </div>
                </div>
                {market.candles.length > 0 ? (
                  <PriceChart
                    candles={market.candles}
                    clusters={analysis?.clusters ?? []}
                    spot={market.spot}
                    oiHistory={market.oiHistory}
                  />
                ) : (
                  <div className="flex h-[340px] animate-pulse items-center justify-center rounded-md border border-line/50 font-mono text-xs text-dusk sm:h-[400px]">
                    CARGANDO VELAS…
                  </div>
                )}
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
                lookback={{ "12h": 16, "24h": 20, "72h": 24, "7d": 18 }[tf]}
                label={`ventana ${TF_CONFIG[tf].label}`}
              />
            )}
          </section>

          {/* pulso del mercado */}
          <section className="panel reveal mt-5" ref={r7}>
            <MarketPulsePanel />
          </section>

          {/* acumulación + track record */}
          <div className="reveal mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_1fr]" ref={r3}>
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
            <BacktestLab spot={market.spot} />
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
          <section className="panel reveal mt-5" ref={r8}>
            <BenchmarkPanel />
          </section>

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
            <span>datos: Binance · estimación propia · {new Date().getFullYear()}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
