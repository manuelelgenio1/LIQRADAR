import type { LiqEvent } from "../lib/engine";
import { fmtCompact, fmtTime, fmtUsd } from "../lib/engine";

interface Props {
  events: LiqEvent[];
  sessionLong: number;
  sessionShort: number;
  live: boolean;
}

export function FeedPanel({ events, sessionLong, sessionShort, live }: Props) {
  const tot = sessionLong + sessionShort;
  const longPct = tot > 0 ? (sessionLong / tot) * 100 : 50;

  return (
    <div className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="panel-tag">M5 · cinta de liquidaciones</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog">Liquidaciones en vivo</h2>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[9.5px] tracking-widest"
          style={{ color: live ? "#2fd6a5" : "#ffb547" }}
        >
          <span className="live-dot" style={{ background: "currentColor", color: "currentColor" }} />
          {live ? "BINANCE FUTUROS" : "SIMULADO"}
        </span>
      </div>

      {/* totales sesión */}
      <div className="mt-4 rounded-md border border-line/70 bg-ink-950/50 p-3">
        <div className="flex justify-between font-mono text-[10.5px] tabular-nums">
          <span className="text-long-hi">LONGS {fmtCompact(sessionLong)}</span>
          <span className="text-dusk">de la sesión</span>
          <span className="text-short-hi">{fmtCompact(sessionShort)} SHORTS</span>
        </div>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-sm bg-ink-900">
          <div className="h-full bg-long transition-all duration-700" style={{ width: `${longPct}%` }} />
          <div className="h-full bg-short transition-all duration-700" style={{ width: `${100 - longPct}%` }} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-dusk">
          {tot === 0
            ? "Esperando liquidaciones… cuando el combustible se quema, aparece aquí."
            : sessionLong > sessionShort
              ? "Se está liquidando más gente en LONG: el lado bajista ya gastó combustible (posible rebote)."
              : "Se está liquidando más gente en SHORT: el lado alcista ya gastó combustible (posible corrección)."}
        </p>
      </div>

      {/* lista */}
      <div className="slim-scroll mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 420, minHeight: 260 }}>
        {events.length === 0 && (
          <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-line/70 font-mono text-[11px] text-dusk">
            ESCUCHANDO LIQUIDACIONES BTC…
          </div>
        )}
        {events.map((e) => (
          <div
            key={e.id}
            className="feed-in grid grid-cols-[64px_52px_1fr_auto] items-center gap-2 rounded-md border border-line/50 bg-ink-950/40 px-2.5 py-1.5 font-mono text-[11px] tabular-nums transition-colors hover:border-line"
          >
            <span className="text-dusk">{fmtTime(e.time)}</span>
            <span
              className="rounded-sm px-1.5 py-0.5 text-center text-[9.5px] font-700 tracking-wider"
              style={
                e.side === "long"
                  ? { background: "rgba(47,214,165,0.12)", color: "#5ef2c4", border: "1px solid rgba(47,214,165,0.4)" }
                  : { background: "rgba(255,77,109,0.14)", color: "#ff7d95", border: "1px solid rgba(255,77,109,0.4)" }
              }
            >
              {e.side === "long" ? "LONG" : "SHORT"}
            </span>
            <span className="text-fog">
              {fmtUsd(e.price, 1)} <span className="text-dusk">· {e.qty.toFixed(4)} BTC</span>
            </span>
            <span className="text-right font-600" style={{ color: e.side === "long" ? "#5ef2c4" : "#ff7d95" }}>
              {fmtCompact(e.notional)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
