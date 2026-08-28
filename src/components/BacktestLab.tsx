import { useRef, useState } from "react";
import type { BtResult, BtTest } from "../lib/backtest";
import { runWalkForward, type BtPos } from "../lib/backtest";
import { fetchKlines, simKlines, fetchTakerSeries, fetchAccountRatioSeries, fetchFundingSeries } from "../lib/binance";
import { fmtUsd, type Candle } from "../lib/engine";
import { calibrateWeights, loadCalibration, saveCalibration, clearCalibration, type Calibration } from "../lib/calibration";

const HORIZONS = [6, 12, 24];

function EquitySpark({ equity }: { equity: number[] }) {
  if (equity.length < 2) return null;
  const w = 300;
  const h = 64;
  const min = Math.min(0, ...equity);
  const max = Math.max(0, ...equity);
  const range = max - min || 1;
  const pts = equity
    .map((v, i) => `${((i / (equity.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  const zeroY = h - ((0 - min) / range) * h;
  const last = equity[equity.length - 1];
  const positive = last >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(93,112,153,0.4)" strokeWidth="1" strokeDasharray="4 4" />
      <polyline points={pts} fill="none" stroke={positive ? "#2fd6a5" : "#ff4d6d"} strokeWidth="2" />
    </svg>
  );
}

function OutcomeChip({ o }: { o: BtTest["outcome"] }) {
  const map = {
    acierto: { c: "#5ef2c4", bg: "rgba(47,214,165,0.12)", bd: "rgba(47,214,165,0.45)" },
    fallo: { c: "#ff7d95", bg: "rgba(255,77,109,0.13)", bd: "rgba(255,77,109,0.45)" },
    caducada: { c: "#8fa1c4", bg: "rgba(143,161,196,0.08)", bd: "rgba(143,161,196,0.3)" },
  }[o];
  return (
    <span className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-700 tracking-wider" style={{ color: map.c, background: map.bg, border: `1px solid ${map.bd}` }}>
      {o.toUpperCase()}
    </span>
  );
}

export function BacktestLab({ spot, onCalibrated, onHitRate }: {
  spot: number;
  onCalibrated: (c: Calibration) => void;
  onHitRate: (hitRate: number, samples: number) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "downloading" | "running" | "done" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [stepNote, setStepNote] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [horizon, setHorizon] = useState(12);
  const [result, setResult] = useState<BtResult | null>(null);
  const [activeCal, setActiveCal] = useState<Calibration | null>(() => loadCalibration());
  const spotRef = useRef(spot);
  spotRef.current = spot;

  const busy = phase === "running" || phase === "downloading";

  const run = async () => {
    if (busy) return;
    console.info("[LiqRadar] prueba iniciada: descargando 1000 velas de 1h…");
    setPhase("downloading");
    setPct(0);
    setResult(null);
    setErrMsg("");
    setStepNote("descargando 1000 velas de 1h desde Binance…");

    let candles: Candle[];
    let sim = false;
    try {
      candles = await fetchKlines("1h", 1000);
      if (candles.length < 200) throw new Error(`Binance devolvió ${candles.length} velas (mínimo 200)`);
      console.info(`[LiqRadar] ${candles.length} velas reales descargadas`);
      setStepNote(`${candles.length} velas reales descargadas · re-ejecutando el motor paso a paso…`);
    } catch (e) {
      sim = true;
      candles = simKlines(spotRef.current, 1000, 3_600_000);
      const why = e instanceof Error ? e.message : "red no disponible";
      console.warn(`[LiqRadar] sin acceso a Binance (${why}) → simulador`);
      setStepNote(`sin acceso a Binance (${why}) → usando simulador coherente…`);
    }

    // series históricas de posicionamiento para validar también funding/takers/cuentas
    let pos: BtPos | undefined;
    if (!sim) {
      setStepNote("descargando históricos de funding, takers y cuentas…");
      const [tk, ac, fu] = await Promise.allSettled([
        fetchTakerSeries("1h", 500),
        fetchAccountRatioSeries("1h", 500),
        fetchFundingSeries(200),
      ]);
      pos = {
        taker: tk.status === "fulfilled" ? tk.value : undefined,
        account: ac.status === "fulfilled" ? ac.value : undefined,
        funding: fu.status === "fulfilled" ? fu.value : undefined,
      };
      const got = [pos.taker, pos.account, pos.funding].filter(Boolean).length;
      setStepNote(
        got > 0
          ? `posicionamiento histórico OK (${got}/3 series) · re-ejecutando el motor…`
          : "sin histórico de posicionamiento (se validan los factores de precio) · re-ejecutando…"
      );
    }

    try {
      setPhase("running");
      const res = await runWalkForward(candles, 3_600_000, horizon, sim, setPct, pos);
      console.info(
        `[LiqRadar] prueba completada: ${res.tests.length} señales · TRAIN ${res.trainHitRate == null ? "—" : res.trainHitRate.toFixed(1) + "%"} · OOS ${res.oosHitRate == null ? "—" : res.oosHitRate.toFixed(1) + "%"} · edge OOS ${res.oosEdgePct == null ? "—" : res.oosEdgePct.toFixed(1) + " pts"} · cobertura posicionamiento ${res.posCoverage.toFixed(0)}%`
      );
      setResult(res);
      setPhase("done");
      // el índice de confiabilidad usa el OOS: la muestra que la calibración jamás vio
      if (res.oosHitRate !== null) onHitRate(res.oosHitRate, res.oosClosed);
    } catch (e) {
      console.error("[LiqRadar] fallo del backtest:", e);
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const applyCalibration = () => {
    if (!result) return;
    // la calibración aprende SOLO del 60% TRAIN; el 40% OOS queda intacto para medir
    const weights = calibrateWeights(result.factorStatsTrain);
    const cal: Calibration = {
      weights,
      savedAt: Date.now(),
      samples: result.trainClosed,
      horizonH: result.horizonH,
      sim: result.sim,
    };
    saveCalibration(cal);
    setActiveCal(cal);
    onCalibrated(cal);
    console.info("[LiqRadar] calibración aplicada: pesos aprendidos del 60% TRAIN (OOS intacto)");
  };

  const resetCalibration = () => {
    clearCalibration();
    setActiveCal(null);
    console.info("[LiqRadar] calibración restablecida a los pesos base");
  };

  const r = result;
  const hitColor = r?.oosHitRate == null ? "#5d7099" : r.oosHitRate >= 55 ? "#2fd6a5" : r.oosHitRate >= 50 ? "#ffb547" : "#ff4d6d";

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">10 · laboratorio de validación</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Funciona de verdad el radar? Pruébalo contra la historia
          </h2>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-mist">
            Descarga ~41 días de velas reales de 1h y re-ejecuta el <b className="text-fog">mismo motor</b> paso a paso
            (walk-forward, sin mirar al futuro). Cada señal se verifica: ¿tocó su objetivo antes que su invalidación?
            Así obtienes la tasa de acierto real del modelo, no una promesa.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {HORIZONS.map((h) => (
            <button key={h} className={`chip ${horizon === h ? "on" : ""}`} onClick={() => setHorizon(h)} disabled={busy}>
              {h}h
            </button>
          ))}
          <button
            onClick={run}
            disabled={busy}
            className="ml-1 rounded-md border border-long/60 bg-long/10 px-4 py-1.5 font-mono text-[12px] font-700 tracking-widest text-long-hi transition-all hover:bg-long/20 hover:shadow-[0_0_18px_-4px_rgba(47,214,165,0.6)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "downloading" ? "⬇ DESCARGANDO…" : phase === "running" ? "EJECUTANDO…" : "▶ EJECUTAR PRUEBA"}
          </button>
          {phase === "done" && result && (
            <button
              className="chip"
              onClick={() => {
                const rows = [
                  "fecha,hora,direccion,veredicto,spot,objetivo,invalidacion,confianza,resultado,pnl_pct,horas",
                  ...result.tests.map((t) =>
                    [
                      new Date(t.time * 1000).toLocaleDateString("es-ES"),
                      new Date(t.time * 1000).toLocaleTimeString("es-ES"),
                      t.dir,
                      t.headline,
                      t.spot.toFixed(2),
                      t.target?.toFixed(2) ?? "",
                      t.inval?.toFixed(2) ?? "",
                      t.confidence,
                      t.outcome,
                      t.pnlPct.toFixed(2),
                      t.hoursToResolve.toFixed(1),
                    ].join(",")
                  ),
                ].join("\n");
                const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `liqradar-backtest-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              exportar csv
            </button>
          )}
        </div>
      </div>

      {(phase === "running" || phase === "downloading") && (
        <div className="mt-5 rounded-lg border border-line/70 bg-ink-950/50 p-4">
          <div className="flex justify-between gap-3 font-mono text-[11px] text-mist">
            <span className="flex items-center gap-2">
              <span className="live-dot" style={{ background: "#2fd6a5", color: "#2fd6a5" }} />
              {stepNote}
            </span>
            <span className="tabular-nums text-long-hi">{phase === "downloading" ? "· · ·" : `${pct}%`}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-900">
            {phase === "downloading" ? (
              <div className="indet-bar h-full rounded-full bg-pulse" />
            ) : (
              <div className="h-full rounded-full bg-long transition-all duration-200" style={{ width: `${pct}%` }} />
            )}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-5 rounded-lg border border-short/40 bg-short/[0.05] p-4">
          <div className="font-mono text-[12px] font-700 tracking-widest text-short-hi">LA PRUEBA FALLÓ</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mist">
            {errMsg || "error desconocido"}. El detalle completo está en la consola del navegador (F12) — revisa la
            conexión a Binance y reintenta.
          </p>
          <button onClick={run} className="chip mt-3">REINTENTAR</button>
        </div>
      )}

      {phase === "done" && r && (
        <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-[280px_1fr_1fr]">
          {/* tasa de acierto — OOS: la muestra que la calibración jamás vio */}
          <div className="flex flex-col justify-between rounded-lg border border-line/70 bg-ink-950/50 p-4">
            <div>
              <span className="flex items-center gap-2">
                <span className="panel-tag">acierto fuera de muestra</span>
                <span className="rounded-sm border border-pulse/50 bg-pulse/10 px-1.5 py-0.5 font-mono text-[8px] font-700 tracking-wider text-pulse" title="Último 40% del histórico: la calibración solo aprendió del 60% anterior, así que este número no está inflado por sobreajuste.">
                  OOS 40%
                </span>
              </span>
              <div className="mt-1 font-mono text-5xl font-700 tabular-nums" style={{ color: hitColor }}>
                {r.oosHitRate == null ? "—" : `${r.oosHitRate.toFixed(1)}%`}
              </div>
              <div className="mt-1 font-mono text-[11px] tabular-nums text-mist">
                edge OOS vs azar (50%):{" "}
                <span className="font-700" style={{ color: (r.oosEdgePct ?? 0) >= 0 ? "#2fd6a5" : "#ff4d6d" }}>
                  {r.oosEdgePct == null ? "—" : `${r.oosEdgePct >= 0 ? "+" : ""}${r.oosEdgePct.toFixed(1)} pts`}
                </span>
              </div>
            </div>

            {/* comparativa TRAIN vs OOS */}
            <div className="mt-3 rounded-md border border-line/50 bg-ink-900/40 p-2.5">
              <div className="flex justify-between font-mono text-[10px] tabular-nums">
                <span className="text-dusk">TRAIN 60% (calibración)</span>
                <span className="font-700 text-mist">{r.trainHitRate == null ? "—" : `${r.trainHitRate.toFixed(1)}%`} <span className="text-dusk">({r.trainHits}/{r.trainClosed})</span></span>
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums">
                <span className="text-dusk">OOS 40% (verificación)</span>
                <span className="font-700" style={{ color: hitColor }}>{r.oosHitRate == null ? "—" : `${r.oosHitRate.toFixed(1)}%`} <span className="text-dusk">({r.oosHits}/{r.oosClosed})</span></span>
              </div>
              {(r.trainHitRate != null && r.oosHitRate != null && r.trainHitRate - r.oosHitRate > 8) && (
                <div className="mt-1.5 font-mono text-[9px] leading-snug text-warn">
                  ⚠ OOS cae {(r.trainHitRate - r.oosHitRate).toFixed(0)} pts vs TRAIN: señal de sobreajuste — la calibración pesa menos de lo que aparenta.
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
              <span className="text-dusk">aciertos</span><span className="text-right font-700 text-long-hi">{r.hits}</span>
              <span className="text-dusk">fallos</span><span className="text-right font-700 text-short-hi">{r.misses}</span>
              <span className="text-dusk">caducadas</span><span className="text-right text-mist">{r.expired}</span>
              <span className="text-dusk">neutros omitidos</span><span className="text-right text-mist">{r.neutralSkipped}</span>
            </div>
            <div className="mt-3 border-t border-line/50 pt-2 font-mono text-[11px] tabular-nums">
              <span className="text-dusk">expectancy / señal</span>{" "}
              <span className="font-700" style={{ color: r.expectancyPct >= 0 ? "#2fd6a5" : "#ff4d6d" }}>
                {r.expectancyPct >= 0 ? "+" : ""}{r.expectancyPct.toFixed(2)}%
              </span>
            </div>
            {r.sim && <div className="mt-2 font-mono text-[9.5px] tracking-widest text-warn">DATOS SIMULADOS (sin conexión)</div>}
          </div>

          {/* por dirección y confianza */}
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
              <span className="panel-tag">acierto por dirección</span>
              {[r.byDir.up, r.byDir.down].map((b) => (
                <div key={b.label} className="mt-2">
                  <div className="flex justify-between font-mono text-[10.5px] tabular-nums text-mist">
                    <span>{b.label}</span>
                    <span>{b.closed > 0 ? `${((b.hits / b.closed) * 100).toFixed(0)}% (${b.hits}/${b.closed})` : "sin señales"}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-900">
                    <div className="h-full rounded-full bg-pulse transition-all duration-500" style={{ width: `${b.closed > 0 ? (b.hits / b.closed) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
              <span className="panel-tag">acierto por confianza del modelo</span>
              {r.byBucket.map((b) => (
                <div key={b.label} className="mt-2 flex items-center justify-between font-mono text-[10.5px] tabular-nums">
                  <span className="text-mist">{b.label}</span>
                  <span className="text-fog">
                    {b.closed > 0 ? `${((b.hits / b.closed) * 100).toFixed(0)}% (${b.hits}/${b.closed})` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* curva + últimas señales */}
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
              <div className="flex items-center justify-between">
                <span className="panel-tag">resultado acumulado si sigues cada señal</span>
                <span className="font-mono text-[10px] text-dusk">{r.candlesUsed} velas · horizonte {r.horizonH}h</span>
              </div>
              <div className="mt-2"><EquitySpark equity={r.equity} /></div>
            </div>
            <div className="slim-scroll flex-1 space-y-1 overflow-y-auto rounded-lg border border-line/70 bg-ink-950/50 p-3" style={{ maxHeight: 168 }}>
              {r.tests.slice(-8).reverse().map((t) => (
                <div key={t.time} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md border border-line/40 px-2.5 py-1 font-mono text-[10.5px] tabular-nums">
                  <OutcomeChip o={t.outcome} />
                  <span className={`font-700 ${t.dir === "up" ? "text-long-hi" : "text-short-hi"}`}>
                    {t.dir === "up" ? "▲ LONG" : "▼ SHORT"}
                  </span>
                  <span className="text-[9px] text-dusk" title={t.headline}>{t.dir === "up" ? "short squeeze" : "long squeeze"}</span>
                  <span className="text-mist">@{fmtUsd(t.spot)} → {t.target ? fmtUsd(t.target) : "—"}</span>
                  <span className="ml-auto text-dusk">{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}% · {t.hoursToResolve.toFixed(0)}h</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* precisión por factor (TRAIN: lo único que alimenta la calibración) */}
      {phase === "done" && r && r.factorStatsTrain.length > 0 && (
        <div className="mt-4 rounded-lg border border-line/70 bg-ink-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="panel-tag">precisión de cada factor · solo TRAIN 60%</span>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-dusk">
                De las señales cerradas del período de entrenamiento, ¿cuántas acertaron cuando el factor apoyó la
                dirección? Es la prueba de qué piezas del motor aportan señal real y cuáles son ruido. El 40% OOS se
                reserva para verificar sin inflar el resultado.
              </p>
            </div>
            <span className="rounded-md border border-line bg-ink-950/70 px-2.5 py-1 font-mono text-[10px] tabular-nums text-mist">
              cobertura posicionamiento real: <b className={r.posCoverage > 50 ? "text-long-hi" : "text-warn"}>{r.posCoverage.toFixed(0)}%</b>
            </span>
          </div>

          {/* auto-calibración de pesos */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warn/25 bg-warn/[0.04] p-3">
            <div className="mr-auto min-w-[220px]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-700 tracking-widest text-warn">AUTO-CALIBRACIÓN</span>
                {activeCal && (
                  <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] font-700 text-warn">ACTIVA</span>
                )}
              </div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-mist">
                Recalcula los pesos del motor según el acierto de cada factor en el 60% TRAIN: los que ganan suben, los
                que fallan bajan. El 40% OOS nunca se toca. {activeCal ? `Aplicada con ${activeCal.samples} señales TRAIN.` : "El modelo usa los pesos base."}
              </p>
            </div>
            <button
              onClick={applyCalibration}
              className="rounded-md border border-warn/60 bg-warn/10 px-3.5 py-1.5 font-mono text-[11px] font-700 tracking-widest text-warn transition-all hover:bg-warn/20 hover:shadow-[0_0_16px_-4px_rgba(255,181,71,0.6)]"
            >
              ⚙ APLICAR AL MOTOR
            </button>
            {activeCal && (
              <button onClick={resetCalibration} className="chip">restablecer</button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {r.factorStatsTrain.map((f) => {
              const rate = f.agreed > 0 ? (f.agreedCorrect / f.agreed) * 100 : null;
              const col = rate == null ? "#5d7099" : rate >= 55 ? "#2fd6a5" : rate >= 50 ? "#ffb547" : "#ff4d6d";
              return (
                <div key={f.id} className="flex items-center gap-3">
                  <span className="w-[168px] shrink-0 truncate text-[11.5px] font-600 text-fog" title={f.label}>
                    {f.label}
                  </span>
                  <div className="relative h-[7px] flex-1 overflow-hidden rounded-full bg-ink-900">
                    <div className="absolute left-1/2 top-0 h-full w-px bg-line" />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{ width: `${rate ?? 0}%`, background: col, opacity: 0.75 }}
                    />
                  </div>
                  <span className="w-[92px] shrink-0 text-right font-mono text-[10.5px] tabular-nums" style={{ color: col }}>
                    {rate == null ? "sin muestra" : `${rate.toFixed(0)}% · n=${f.agreed}`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 font-mono text-[9.5px] leading-relaxed text-dusk">
            n = veces que el factor apoyó la dirección en señales cerradas. Factores con n bajo o sin muestra no tienen
            histórico suficiente aún. La cobertura indica qué fracción de tests usó funding/takers/cuentas reales.
          </p>
        </div>
      )}

      {phase === "idle" && (
        <div className="mt-5 rounded-lg border border-dashed border-line/70 px-5 py-7 text-center font-mono text-[12px] leading-relaxed text-dusk">
          Pulsa «▶ EJECUTAR PRUEBA» — primero descarga ~41 días de velas reales de Binance (unos segundos) y luego
          re-ejecuta el motor sobre cada una. Verás el progreso en vivo y el detalle en la consola (F12).
          <br />
          Si tu red bloquea Binance, la prueba corre igual sobre el simulador y lo indica con transparencia.
        </div>
      )}
    </div>
  );
}
