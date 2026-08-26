import type { Verdict } from "../lib/engine";
import { fmtUsd } from "../lib/engine";

const DIR_STYLE = {
  up: { color: "#2fd6a5", word: "ALCISTA", arrow: "▲" },
  down: { color: "#ff4d6d", word: "BAJISTA", arrow: "▼" },
  neutral: { color: "#ffb547", word: "NEUTRO", arrow: "◆" },
} as const;

export function PredictionPanel({ v, updatedAt }: { v: Verdict; updatedAt: number }) {
  const s = DIR_STYLE[v.direction];
  const R = 52;
  const C = 2 * Math.PI * R;
  const needlePct = (v.scorePct + 100) / 2; // 0..100

  return (
    <div className="flex h-full flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="panel-tag">01 · motor de predicción</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Caza de longs o squeeze de shorts?
          </h2>
        </div>
        <span className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-mist">
          {new Date(updatedAt).toLocaleTimeString("es-ES")}
        </span>
      </div>

      {/* veredicto */}
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-line/70 bg-ink-950/50 p-5">
        {/* anillo de confianza */}
        <div className="verdict-pulse relative shrink-0 rounded-full" style={{ width: 128, height: 128 }}>
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={R} fill="none" stroke="#15233c" strokeWidth="9" />
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - v.confidence / 100)}
              transform="rotate(-90 64 64)"
              style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.25,1), stroke .4s", filter: `drop-shadow(0 0 8px ${s.color}66)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-2xl font-700 tabular-nums" style={{ color: s.color }}>
              {v.confidence}%
            </span>
            <span className="panel-tag mt-0.5">confianza</span>
          </div>
        </div>

        <div className="min-w-[200px] flex-1">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-dusk">
            <span className="live-dot" style={{ background: s.color, color: s.color }} />
            VEREDICTO {s.word}
          </div>
          <div
            className="font-display mt-1 text-2xl font-900 leading-tight tracking-tight sm:text-[27px]"
            style={{ color: s.color, textShadow: `0 0 26px ${s.color}55` }}
          >
            {v.headline}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-mist">{v.sub}</p>

          {/* medidor de sesgo */}
          <div className="mt-4">
            <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg,#ff4d6d,#3a2530 34%,#15233c 50%,#1d3a33 66%,#2fd6a5)" }}>
              <div
                className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-fog shadow-[0_0_10px_rgba(233,241,255,0.9)] transition-all duration-700"
                style={{ left: `calc(${needlePct}% - 1px)` }}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-dusk">
              <span>LONG SQUEEZE −100</span>
              <span className="tabular-nums text-mist">sesgo {v.scorePct > 0 ? "+" : ""}{v.scorePct}</span>
              <span>+100 SHORT SQUEEZE</span>
            </div>
          </div>
        </div>
      </div>

      {/* niveles clave */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-md border border-line/70 bg-ink-950/50 px-3.5 py-3">
          <div className="panel-tag">objetivo · imán de liquidez</div>
          <div className="mt-1 font-mono text-lg font-700 tabular-nums" style={{ color: s.color }}>
            {v.target ? fmtUsd(v.target.price) : "—"}
          </div>
          <div className="font-mono text-[10.5px] text-dusk">
            {v.target ? `${v.target.side === "long" ? "liq longs" : "liq shorts"} · a ${v.target.distancePct.toFixed(2)}%` : "sin cluster definido"}
          </div>
        </div>
        <div className="rounded-md border border-line/70 bg-ink-950/50 px-3.5 py-3">
          <div className="panel-tag">invalidación</div>
          <div className="mt-1 font-mono text-lg font-700 tabular-nums text-warn">
            {v.invalidation ? fmtUsd(v.invalidation.price) : "—"}
          </div>
          <div className="font-mono text-[10.5px] text-dusk">
            {v.invalidation ? `barrer ${v.invalidation.side === "long" ? "longs" : "shorts"} anula el escenario` : "escenario sin invalidación clara"}
          </div>
        </div>
        <div className="rounded-md border border-line/70 bg-ink-950/50 px-3.5 py-3">
          <div className="panel-tag">ventana estimada</div>
          <div className="mt-1 font-mono text-lg font-700 tabular-nums text-fog">
            {v.windowH[0]}–{v.windowH[1]} h
          </div>
          <div className="font-mono text-[10.5px] text-dusk">según distancia ÷ volatilidad ATR</div>
        </div>
      </div>

      {/* factores */}
      <div>
        <div className="panel-tag mb-2">factores del modelo · contribución al sesgo</div>
        <div className="flex flex-col gap-1.5">
          {v.factors.map((f) => {
            const w = Math.abs(f.score) * f.weight * 100;
            const pos = f.score >= 0;
            return (
              <div
                key={f.id}
                className="group grid grid-cols-[minmax(120px,170px)_1fr_130px] items-center gap-3 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-line/70 hover:bg-ink-950/40"
              >
                <span className="text-[12px] font-600 text-fog">{f.label}</span>
                <span className="truncate font-mono text-[10.5px] text-mist" title={f.detail}>
                  {f.detail}
                </span>
                <div className="relative h-[7px] rounded-full bg-ink-950/80">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-line" />
                  <div
                    className="absolute top-0 h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(w, 50)}%`,
                      left: pos ? "50%" : `${50 - Math.min(w, 50)}%`,
                      background: pos ? "linear-gradient(90deg,#157a5c,#2fd6a5)" : "linear-gradient(90deg,#ff4d6d,#8f1f36)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
