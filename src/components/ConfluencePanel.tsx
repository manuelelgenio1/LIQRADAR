import { useEffect, useState } from "react";
import { fmtUsd } from "../lib/engine";
import { CONFLUENCE_TFS, type ConfluenceState } from "../hooks/useConfluence";
import type { TfBias } from "../lib/engine";

/* Reloj "hace Xs" que late cada segundo — prueba visual de que el panel está vivo */
function TimeAgo({ t }: { t: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!t) return <span>—</span>;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return <span>{s < 3 ? "ahora mismo" : `hace ${s}s`}</span>;
}

/* ============================================================
   Confluencia Multi-Timeframe: corre el motor en 1h, 4h y 1d
   a la vez y mide cuánto coinciden. Una señal respaldada por los
   tres horizontes es mucho más fiable que una aislada.
   ============================================================ */

const DIR_COLOR: Record<TfBias["direction"], string> = {
  up: "#2fd6a5",
  down: "#ff4d6d",
  neutral: "#ffb547",
};

export function ConfluencePanel({ spot, confluence }: { spot: number; confluence: ConfluenceState }) {
  const { biases, tfStatus, loading, sim, anyLive, grade, gradeLabel, alignedDir, lastUpdated, refresh } = confluence;
  const liveCount = CONFLUENCE_TFS.filter((t) => tfStatus[t.tf]?.ok).length;
  const R = 56;
  const C = 2 * Math.PI * R;
  const gradeColor = alignedDir === "up" ? "#2fd6a5" : alignedDir === "down" ? "#ff4d6d" : "#ffb547";
  const agree = Math.round(grade / 33.34); // 0..3

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">confluencia MTF · 1H / 4H / 1D</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Coinciden los tres horizontes?
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El motor se ejecuta <b className="text-fog">por separado en 1h, 4h y 1d</b>. Cuando todos miran al mismo
            lado, la probabilidad de que el barrido ocurra sube mucho; cuando discrepan, la señal es débil y conviene
            esperar. Esta es la técnica que más filtra falsas señales — y ya está integrada en el índice de confiabilidad.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sim ? (
            <span className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 font-mono text-[10px] text-warn">
              SIN DATOS · NEUTRO
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-[10px]"
              style={{ color: liveCount === 3 ? "#2fd6a5" : "#ffb547" }}
            >
              <span className="live-dot" style={{ background: "currentColor", color: "currentColor" }} />
              {liveCount === 3 ? "EN VIVO · 3/3" : `PARCIAL · ${liveCount}/3`}
            </span>
          )}
          <span className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-mist">
            <TimeAgo t={lastUpdated} />
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="chip disabled:cursor-not-allowed disabled:opacity-50"
            title="Recalcular los tres horizontes ahora"
          >
            {loading ? "⟳ CALCULANDO" : "⟳ ACTUALIZAR"}
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-stretch">
        {/* grado de confluencia */}
        <div className="flex shrink-0 flex-col items-center justify-center rounded-lg border border-line/70 bg-ink-950/50 px-8 py-6">
          <div className="relative" style={{ width: 140, height: 140 }}>
            <svg width="140" height="140" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r={R} fill="none" stroke="#15233c" strokeWidth="10" />
              <circle
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={gradeColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - grade / 100)}
                transform="rotate(-90 70 70)"
                style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.25,1)", filter: `drop-shadow(0 0 10px ${gradeColor}66)` }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-3xl font-700 tabular-nums" style={{ color: gradeColor }}>
                {loading ? "…" : `${agree}/3`}
              </span>
              <span className="panel-tag mt-1">acuerdo</span>
            </div>
          </div>
          <div className="mt-3 text-center font-mono text-[11px] font-700 tracking-widest" style={{ color: gradeColor }}>
            {loading ? "CALCULANDO…" : gradeLabel}
          </div>
        </div>

        {/* medidores por timeframe */}
        <div className="flex flex-1 flex-col justify-center gap-3">
          {CONFLUENCE_TFS.map((t) => {
            const b = biases.find((x) => x.tf === t.tf);
            const st = tfStatus[t.tf] ?? { candles: 0, ok: false };
            const pct = b ? (b.scorePct + 100) / 2 : 50;
            const color = b ? DIR_COLOR[b.direction] : "#5d7099";
            return (
              <div key={t.tf} className="group rounded-lg border border-line/60 bg-ink-950/40 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-line">
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[13px] font-700 tabular-nums text-fog">{t.label}</span>
                    <span className="font-mono text-[9.5px] text-dusk">{t.desc}</span>
                  </div>
                  <span className="font-mono text-[13px] font-700 tracking-widest" style={{ color, textShadow: `0 0 16px ${color}55` }}>
                    {loading ? "…" : b?.word}
                    {b && (
                      <span className="ml-1.5 text-[10px] tabular-nums" style={{ color: "#93a5c8" }}>
                        {loading ? "" : `${b.scorePct > 0 ? "+" : ""}${b.scorePct}`}
                      </span>
                    )}
                  </span>
                </div>
                {/* estado de los datos detrás de este horizonte */}
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px]">
                  {loading ? (
                    <span className="text-dusk">descargando velas…</span>
                  ) : st.ok ? (
                    <span className="text-long">
                      {st.candles} velas reales · Binance <span aria-hidden>✓</span>
                    </span>
                  ) : (
                    <span className="text-short">SIN DATOS · usa ⟳ ACTUALIZAR</span>
                  )}
                </div>
                <div className="relative mt-2 h-2 rounded-full" style={{ background: "linear-gradient(90deg,#ff4d6d,#3a2530 34%,#15233c 50%,#1d3a33 66%,#2fd6a5)" }}>
                  <div
                    className="absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-fog shadow-[0_0_10px_rgba(233,241,255,0.9)] transition-all duration-700"
                    style={{ left: `calc(${pct}% - 1px)` }}
                  />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[8.5px] text-dusk">
                  <span>SHORT</span>
                  <span>LONG</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line/40 pt-3 font-mono text-[10.5px] text-dusk">
        <span>Spot de referencia</span>
        <b className="text-warn">{fmtUsd(spot)}</b>
        <span className="text-line">·</span>
        <span>
          Regla práctica: opera solo cuando el acuerdo sea <b className="text-fog">2/3 o 3/3</b> y en la dirección de la
          mayoría; con 1/3 o sin acuerdo, el mercado está en rango y los barridos fallan más.
        </span>
        <span className="ml-auto tabular-nums">
          {anyLive ? (
            <span className="text-long">{liveCount}/3 horizontes con datos reales</span>
          ) : (
            <span className="text-warn">sin datos · revisa tu conexión a Binance</span>
          )}{" "}
          · auto-refresh 90s
        </span>
      </p>
    </div>
  );
}
