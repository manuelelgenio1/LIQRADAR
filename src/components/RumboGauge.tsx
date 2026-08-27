import type { CSSProperties } from "react";
import type { Verdict } from "../lib/engine";
import { fmtUsd } from "../lib/engine";

export interface BiasPoint {
  t: number;
  score: number;
}

/* Instrumento de rumbo: ¿hacia dónde va el mercado, LONG o SHORT?
   scorePct ∈ [-100, +100]:  + → sesgo alcista (LONG) · − → sesgo bajista (SHORT) */
export function RumboGauge({ v, history = [], magnetClose = false, magnetPrice }: {
  v: Verdict;
  history?: BiasPoint[];
  magnetClose?: boolean;
  magnetPrice?: number | null;
}) {
  const angle = (Math.max(-100, Math.min(100, v.scorePct)) / 100) * 84;
  const dir = v.direction;
  const color = dir === "up" ? "#2fd6a5" : dir === "down" ? "#ff4d6d" : "#ffb547";
  const word = dir === "up" ? "LONG" : dir === "down" ? "SHORT" : "NEUTRO";
  const tag = dir === "up" ? "rumbo alcista" : dir === "down" ? "rumbo bajista" : "sin rumbo definido";

  // ticks cada 20 unidades
  const ticks = [];
  for (let p = -100; p <= 100; p += 20) {
    const a = (p / 100) * 84;
    ticks.push(
      <line
        key={p}
        x1="150"
        y1="42"
        x2="150"
        y2={p % 40 === 0 ? "30" : "36"}
        stroke={p === 0 ? "#ffb547" : "rgba(93,112,153,0.5)"}
        strokeWidth={p % 40 === 0 ? 2 : 1}
        transform={`rotate(${a} 150 150)`}
      />
    );
  }

  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(620px 260px at 18% 100%, ${color}14, transparent 70%)` }} />

      {/* alerta de zona magnética */}
      {magnetClose && (
        <div
          className="feed-in absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-md border px-4 py-2 font-mono text-[11px] font-700 tracking-widest text-warn shadow-[0_0_26px_-6px_rgba(255,181,71,0.7)]"
          style={{ borderColor: "rgba(255,181,71,0.55)", background: "rgba(20,17,6,0.92)", "--pulse-color": "#ffb547" } as React.CSSProperties}
        >
          <span className="live-dot" style={{ background: "#ffb547", color: "#ffb547" }} />
          ZONA MAGNÉTICA · PRECIO A {magnetPrice ? fmtUsd(magnetPrice) : "—"} DEL IMÁN
        </div>
      )}

      <div className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-[330px_1fr]">
        {/* dial */}
        <div className="mx-auto w-full max-w-[330px]">
          <svg viewBox="0 0 300 180" className="w-full">
            <defs>
              <linearGradient id="rumboArc" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#ff4d6d" />
                <stop offset="0.42" stopColor="#a1403f" />
                <stop offset="0.5" stopColor="#ffb547" />
                <stop offset="0.58" stopColor="#3d9a77" />
                <stop offset="1" stopColor="#2fd6a5" />
              </linearGradient>
            </defs>

            {/* arco base */}
            <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="rgba(21,35,60,0.9)" strokeWidth="16" strokeLinecap="round" />
            {/* arco coloreado */}
            <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="url(#rumboArc)" strokeWidth="10" strokeLinecap="round" opacity="0.9" />
            {ticks}

            {/* etiquetas SHORT / LONG */}
            <text x="26" y="172" textAnchor="middle" className="fill-[#ff7d95] font-mono text-[12px] font-700">SHORT</text>
            <text x="274" y="172" textAnchor="middle" className="fill-[#5ef2c4] font-mono text-[12px] font-700">LONG</text>
            <text x="150" y="20" textAnchor="middle" className="fill-[#5d7099] font-mono text-[9px] tracking-widest">0</text>

            {/* aguja */}
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "150px 150px", transition: "transform 0.9s cubic-bezier(.2,.8,.25,1)" }}>
              <polygon points="150,52 145,150 155,150" fill={color} style={{ filter: `drop-shadow(0 0 7px ${color})` }} />
              <circle cx="150" cy="52" r="4.5" fill={color} style={{ filter: `drop-shadow(0 0 9px ${color})` }} />
            </g>
            {/* pivote */}
            <circle cx="150" cy="150" r="9" fill="#0d1a30" stroke={color} strokeWidth="2.5" />
            <circle cx="150" cy="150" r="3" fill={color} />
          </svg>
        </div>

        {/* lectura */}
        <div>
          <div className="flex items-center gap-2">
            <span className="live-dot" style={{ background: color, color }} />
            <span className="panel-tag">rumbo del mercado · btc global 24/7 · binance</span>
          </div>

          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span
              className="font-display text-5xl font-900 leading-none tracking-tight sm:text-6xl"
              style={{ color, textShadow: `0 0 34px ${color}59` }}
            >
              {word}
            </span>
            <span className="font-mono text-sm font-600 uppercase tracking-widest text-mist">{tag}</span>
          </div>

          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-mist">{v.sub}</p>

          <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 font-mono text-[12px] tabular-nums">
            <div>
              <span className="panel-tag mr-2">sesgo</span>
              <span className="font-700" style={{ color }}>{v.scorePct > 0 ? "+" : ""}{v.scorePct}</span>
            </div>
            <div>
              <span className="panel-tag mr-2">confianza</span>
              <span className="font-700 text-fog">{v.confidence}%</span>
            </div>
            <div>
              <span className="panel-tag mr-2">imán</span>
              <span className="font-700 text-fog">{v.target ? fmtUsd(v.target.price) : "—"}</span>
            </div>
            <div>
              <span className="panel-tag mr-2">invalidación</span>
              <span className="font-700 text-warn">{v.invalidation ? fmtUsd(v.invalidation.price) : "—"}</span>
            </div>
            <div>
              <span className="panel-tag mr-2">ventana</span>
              <span className="font-700 text-fog">{v.windowH[0]}–{v.windowH[1]}h</span>
            </div>
          </div>
        </div>
      </div>

      {/* historial de sesgo */}
      <div className="relative mt-4 border-t border-line/50 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="panel-tag">evolución del sesgo en esta sesión</span>
          <span className="font-mono text-[10px] tabular-nums text-dusk">
            {history.length > 1 ? `${history.length} lecturas · últimos ${Math.round((history[history.length - 1].t - history[0].t) / 60000)} min` : "recopilando lecturas…"}
          </span>
        </div>
        <BiasHistory points={history} color={color} />
      </div>
    </div>
  );
}

function BiasHistory({ points, color }: { points: BiasPoint[]; color: string }) {
  const W = 900;
  const H = 74;
  const PAD = 4;
  if (points.length < 2) {
    return <div className="mt-2 flex h-[74px] items-center justify-center font-mono text-[10px] text-dusk">el radar registra el sesgo cada pocos segundos…</div>;
  }
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (s: number) => H / 2 - (Math.max(-100, Math.min(100, s)) / 100) * (H / 2 - PAD);
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[74px] w-full" preserveAspectRatio="none">
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="rgba(255,181,71,0.4)" strokeWidth="1" strokeDasharray="4 5" />
      <text x={W - PAD} y={H / 2 - 5} textAnchor="end" className="fill-[#5ef2c4] font-mono text-[9px]">LONG +</text>
      <text x={W - PAD} y={H / 2 + 12} textAnchor="end" className="fill-[#ff7d95] font-mono text-[9px]">SHORT −</text>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 5px ${color}66)` }}
      />
      <circle cx={x(points.length - 1)} cy={y(last.score)} r="4" fill={color}>
        <animate attributeName="r" values="4;6;4" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
