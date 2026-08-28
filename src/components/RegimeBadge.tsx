import type { RegimeInfo } from "../lib/engine";
import type { MarketRegime } from "../lib/regime";

/* Espectro de volatilidad: posición del ATR% dentro de los umbrales de régimen */
const SPECTRUM = [
  { stop: 0.15, color: "#3fb6ff" }, // calma
  { stop: 0.45, color: "#2fd6a5" }, // normal
  { stop: 0.9, color: "#ffb547" }, // alta
  { stop: 1.4, color: "#ff4d6d" }, // extrema (tope visual)
];

function spectrumPos(atrPct: number): number {
  const top = SPECTRUM[SPECTRUM.length - 1].stop;
  return Math.min(100, Math.max(2, (atrPct / top) * 100));
}

export function RegimeBadge({ regime, market }: { regime: RegimeInfo; market?: MarketRegime | null }) {
  const { label, color, atrPct, note, windowScale } = regime;
  const pos = spectrumPos(atrPct);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line/60 bg-ink-950/60 px-4 py-3">
      {/* etiqueta de régimen */}
      <div className="flex items-center gap-2.5">
        <span
          className="live-dot"
          style={{ background: color, color, animationDuration: regime.regime === "extreme" ? "0.7s" : regime.regime === "high" ? "1.1s" : "1.8s" }}
        />
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[15px] font-900 tracking-wide" style={{ color, textShadow: `0 0 18px ${color}55` }}>
              {label}
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-mist">ATR {atrPct.toFixed(2)}%/h</span>
          </div>
          <div className="panel-tag">régimen de volatilidad</div>
        </div>
      </div>

      {/* régimen de mercado state-first (guardia de la dirección) */}
      {market && (
        <div className="flex items-center gap-2.5 rounded-md border px-3 py-1.5" style={{ borderColor: `${market.color}44`, background: `${market.color}0d` }}>
          <span className="font-mono text-[10px] font-700 tracking-[0.14em]" style={{ color: market.color }}>
            {market.label}
          </span>
          <span className="hidden font-mono text-[9.5px] text-dusk md:block" title={market.note}>
            {market.allowUp && market.allowDown ? "ambos lados abiertos" : !market.allowUp && !market.allowDown ? "sin ventaja · señales bloqueadas" : market.allowUp ? "ventaja ▲ LONG" : "ventaja ▼ SHORT"}
          </span>
        </div>
      )}

      {/* espectro */}
      <div className="min-w-[110px] flex-1">
        <div
          className="relative h-1.5 rounded-full"
          style={{ background: "linear-gradient(90deg,#3fb6ff,#2fd6a5 32%,#ffb547 62%,#ff4d6d)" }}
        >
          <div
            className="absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-fog shadow-[0_0_10px_rgba(233,241,255,0.9)] transition-all duration-700"
            style={{ left: `calc(${pos}% - 1px)` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[8px] text-dusk">
          <span>calma</span>
          <span>extrema</span>
        </div>
      </div>

      {/* nota + efecto en ventana */}
      <div className="hidden max-w-[260px] flex-col lg:flex">
        <p className="text-[10.5px] leading-snug text-dusk">{note}</p>
        <span className="mt-0.5 font-mono text-[9px] tabular-nums text-mist">
          ventana temporal ×{windowScale.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
