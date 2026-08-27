import type { CSSProperties } from "react";
import type { Verdict } from "../lib/engine";
import { fmtUsd } from "../lib/engine";

const DIR_STYLE = {
  up: { color: "#2fd6a5", word: "ALCISTA", arrow: "▲" },
  down: { color: "#ff4d6d", word: "BAJISTA", arrow: "▼" },
  neutral: { color: "#ffb547", word: "NEUTRO", arrow: "◆" },
} as const;

function SchoolMeter({ label, pct, n }: { label: string; pct: number; n: number }) {
  const color = pct >= 15 ? "#2fd6a5" : pct <= -15 ? "#ff4d6d" : "#93a5c8";
  const word = pct >= 15 ? "LONG" : pct <= -15 ? "SHORT" : "NEUTRA";
  const width = Math.min(Math.abs(pct) / 2, 50); // mitad del track por lado
  return (
    <div className="rounded-md border border-line/60 bg-ink-900/50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-600 text-fog">{label}</span>
        <span className="font-mono text-[11px] font-700 tabular-nums" style={{ color }}>
          {word} {pct > 0 ? "+" : ""}
          {pct}
        </span>
      </div>
      <div className="relative mt-2 h-[7px] rounded-full bg-ink-950/80">
        <div className="absolute left-1/2 top-0 h-full w-px bg-line" />
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-700"
          style={{
            width: `${width}%`,
            left: pct >= 0 ? "50%" : `${50 - width}%`,
            background: pct >= 0 ? "linear-gradient(90deg,#157a5c,#2fd6a5)" : "linear-gradient(90deg,#ff4d6d,#8f1f36)",
          }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-dusk">
        <span>{n} factores</span>
        <span>voto ponderado</span>
      </div>
    </div>
  );
}

export function PredictionPanel({ v, updatedAt }: { v: Verdict; updatedAt: number }) {
  const s = DIR_STYLE[v.direction];
  const R = 52;
  const C = 2 * Math.PI * R;
  const needlePct = (v.scorePct + 100) / 2; // 0..100
  const harmonyColor = v.harmony >= 70 ? "#2fd6a5" : v.harmony >= 45 ? "#ffb547" : "#ff4d6d";
  const cF = v.factors.filter((f) => f.school === "contrarian");
  const mF = v.factors.filter((f) => f.school === "momentum");

  return (
    <div className="flex h-full flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="panel-tag">M4 · motor de predicción</div>
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
        <div
          className="verdict-pulse relative shrink-0 rounded-full"
          style={{ width: 128, height: 128, "--pulse-color": s.color } as CSSProperties}
        >
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

      {/* armonía entre escuelas: quién dice qué y cuánto pesa cada una */}
      <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="panel-tag">armonía de escuelas</span>
          <span
            className="rounded-md px-2.5 py-1 font-mono text-[11px] font-700 tabular-nums"
            style={{ color: harmonyColor, background: `${harmonyColor}12`, border: `1px solid ${harmonyColor}44` }}
          >
            {v.harmony}% de acuerdo
          </span>
          <span className="rounded-md border border-line bg-ink-900/60 px-2.5 py-1 font-mono text-[10.5px] tabular-nums text-mist">
            fase de caza · peso {v.gatePct}%
          </span>
          <span className="ml-auto hidden font-mono text-[9.5px] text-dusk sm:block">
            convención: el voto apunta al movimiento esperado (multitud long = voto bajista)
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SchoolMeter label="Escuela contrarian · caza de liquidaciones" pct={v.contrarianPct} n={cF.length} />
          <SchoolMeter label="Escuela de impulso · tendencia y flujo" pct={v.momentumPct} n={mF.length} />
        </div>
      </div>

      {/* alertas del modelo */}
      {v.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {v.warnings.map((w, i) => (
            <div
              key={i}
              className="feed-in flex items-start gap-2 rounded-md border px-3 py-2 text-[11.5px] leading-snug"
              style={
                w.tone === "danger"
                  ? { borderColor: "rgba(255,77,109,0.4)", background: "rgba(255,77,109,0.07)", color: "#ff9fae" }
                  : { borderColor: "rgba(255,181,71,0.4)", background: "rgba(255,181,71,0.06)", color: "#ffce87" }
              }
            >
              <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden className="mt-[2px] shrink-0">
                <path d="M9 1.8 17 15.4H1L9 1.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M9 7v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="9" cy="13" r="0.9" fill="currentColor" />
              </svg>
              {w.text}
            </div>
          ))}
        </div>
      )}

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
        <div className="panel-tag mb-2">
          factores del modelo · contribución al sesgo <span className="text-mist">({v.factors.length})</span>
        </div>
        <div className="slim-scroll flex max-h-[340px] flex-col gap-1 overflow-y-auto pr-1">
          <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] font-700 tracking-[0.18em] text-mist">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#ff4d6d" }} />
            ESCUELA CONTRARIAN — {cF.length} factores
          </div>
          {cF.map((f) => (
            <FactorRow key={f.id} f={f} />
          ))}
          <div className="mt-2 flex items-center gap-2 font-mono text-[9.5px] font-700 tracking-[0.18em] text-mist">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#3fb6ff" }} />
            ESCUELA DE IMPULSO — {mF.length} factores
          </div>
          {mF.map((f) => (
            <FactorRow key={f.id} f={f} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FactorRow({ f }: { f: Verdict["factors"][number] }) {
  const w = Math.abs(f.score) * f.weight * 100;
  const pos = f.score >= 0;
  return (
    <div className="group grid grid-cols-[minmax(120px,170px)_1fr_130px] items-center gap-3 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-line/70 hover:bg-ink-950/40">
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
}


