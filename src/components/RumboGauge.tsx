import { useState } from "react";
import type { CSSProperties } from "react";
import type { Verdict } from "../lib/engine";
import { fmtUsd } from "../lib/engine";

export interface BiasPoint {
  t: number;
  score: number;
}

/* Instrumento de rumbo: ¿hacia dónde va el mercado, LONG o SHORT?
   scorePct ∈ [-100, +100]:  + → sesgo alcista (LONG) · − → sesgo bajista (SHORT) */
export function RumboGauge({ v, spot, history = [], magnetClose = false, magnetPrice, reliability = null }: {
  v: Verdict;
  spot: number;
  history?: BiasPoint[];
  magnetClose?: boolean;
  magnetPrice?: number | null;
  reliability?: number | null;
}) {
  const angle = (Math.max(-100, Math.min(100, v.scorePct)) / 100) * 84;
  const dir = v.direction;
  const color = dir === "up" ? "#2fd6a5" : dir === "down" ? "#ff4d6d" : "#ffb547";
  const word = dir === "up" ? "LONG" : dir === "down" ? "SHORT" : "NEUTRO";
  const tag = dir === "up" ? "rumbo alcista" : dir === "down" ? "rumbo bajista" : "sin rumbo definido";

  const [copied, setCopied] = useState(false);
  const copySignal = () => {
    const lines = [
      `LiqRadar · BTC ${new Date().toLocaleString("es-ES")}`,
      `RUMBO: ${word} (sesgo ${v.scorePct > 0 ? "+" : ""}${v.scorePct} · confianza ${v.confidence}%)`,
      `Spot: ${fmtUsd(spot)}`,
      `Imán de liquidez: ${v.target ? fmtUsd(v.target.price) : "—"}`,
      `Invalidación: ${v.invalidation ? fmtUsd(v.invalidation.price) : "—"}`,
      `Ventana: ${v.windowH[0]}–${v.windowH[1]}h`,
      v.sub,
    ];
    try {
      if (navigator.clipboard) void navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      /* noop */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

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

  // etiquetas numéricas de escala (−100 … +100)
  const scaleLabels = [-100, -50, 0, 50, 100].map((p) => {
    const rad = ((p / 100) * 84 * Math.PI) / 180;
    const x = 150 + 96 * Math.sin(rad);
    const y = 150 - 96 * Math.cos(rad);
    return { p, x, y };
  });

  // arco de sesgo: del cero hasta la posición de la aguja (magnitud del rumbo)
  const rad = (angle * Math.PI) / 180;
  const ax = 150 + 120 * Math.sin(rad);
  const ay = 150 - 120 * Math.cos(rad);
  const biasArc =
    Math.abs(angle) < 1.5
      ? ""
      : `M 150 30 A 120 120 0 0 ${angle > 0 ? 1 : 0} ${ax.toFixed(1)} ${ay.toFixed(1)}`;

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
            <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="url(#rumboArc)" strokeWidth="10" strokeLinecap="round" opacity="0.35" />
            {/* arco de sesgo activo (cero → aguja), brilla con la magnitud del rumbo */}
            {biasArc && (
              <path
                d={biasArc}
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: "d 0.9s cubic-bezier(.2,.8,.25,1), stroke 0.4s" }}
              />
            )}
            {ticks}

            {/* escala numérica */}
            {scaleLabels.map(({ p, x, y }) => (
              <text
                key={p}
                x={x}
                y={y + 3}
                textAnchor="middle"
                className="font-mono text-[8.5px]"
                fill={p === 0 ? "#ffb547" : "#5d7099"}
                fontWeight={p === 0 ? 700 : 400}
              >
                {p > 0 ? `+${p}` : p}
              </text>
            ))}

            {/* etiquetas SHORT / LONG */}
            <text x="26" y="172" textAnchor="middle" className="fill-[#ff7d95] font-mono text-[12px] font-700">SHORT</text>
            <text x="274" y="172" textAnchor="middle" className="fill-[#5ef2c4] font-mono text-[12px] font-700">LONG</text>

            {/* aguja con contrapeso */}
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "150px 150px", transition: "transform 0.9s cubic-bezier(.2,.8,.25,1)" }}>
              <line x1="150" y1="150" x2="150" y2="167" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.45" />
              <polygon points="150,50 144.5,150 155.5,150" fill={color} style={{ filter: `drop-shadow(0 0 7px ${color})` }} />
              <circle cx="150" cy="50" r="4.5" fill={color} style={{ filter: `drop-shadow(0 0 9px ${color})` }} />
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
            <button
              onClick={copySignal}
              className="ml-auto rounded-md border border-line px-2.5 py-1 font-mono text-[10px] tracking-widest text-mist transition-all hover:border-long/60 hover:text-long-hi"
              title="Copiar la señal actual al portapapeles"
            >
              {copied ? "✓ COPIADA" : "⧉ COPIAR SEÑAL"}
            </button>
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

          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-mist">{v.narrative || v.sub}</p>

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

          {/* índice de confiabilidad de la señal */}
          {reliability !== null && (
            <div className="mt-4 max-w-xl">
              <div className="flex items-baseline justify-between">
                <span className="panel-tag">confiabilidad de esta señal</span>
                <span className="font-mono text-[12px] font-700 tabular-nums" style={{ color: reliabilityColor(reliability) }}>
                  {Math.round(reliability)} / 100
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/80">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${reliability}%`, background: `linear-gradient(90deg, ${reliabilityColor(reliability)}55, ${reliabilityColor(reliability)})` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-dusk">
                Combina la confianza del modelo, tu tasa de acierto histórica, la frescura de los datos y —sobre todo— la
                confluencia multi-timeframe: si 12h, 24h y 72h apuntan al mismo lado que el rumbo, la confiabilidad sube;
                si discrepan, baja. {reliability >= 65 ? "Señal sólida: sigue tu plan y el tamaño de posición." : reliability >= 45 ? "Señal media: reduce el tamaño o espera más confirmación." : "Señal débil: mejor esperar — la incertidumbre domina."}{" "}
                Ninguna señal es una certeza.
              </p>
            </div>
          )}
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

function reliabilityColor(r: number): string {
  return r >= 65 ? "#2fd6a5" : r >= 45 ? "#ffb547" : "#ff4d6d";
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
