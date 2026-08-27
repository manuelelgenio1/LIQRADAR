import { useEffect, useState } from "react";
import type { MarketData } from "../hooks/useMarket";
import { fmtUsd } from "../lib/engine";

function useCountdownLabel(nextFundingTime: number): string {
  const [label, setLabel] = useState("--:--");
  useEffect(() => {
    const id = setInterval(() => {
      if (!nextFundingTime) return setLabel("--:--");
      const ms = nextFundingTime - Date.now();
      if (ms <= 0) return setLabel("00:00");
      const h = Math.floor(ms / 3600_000);
      const m = Math.floor((ms % 3600_000) / 60_000);
      setLabel(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(id);
  }, [nextFundingTime]);
  return label;
}

export function TopBar({ m, soundOn, onToggleSound }: { m: MarketData; soundOn: boolean; onToggleSound: () => void }) {
  const up = m.dir >= 0;
  const fundingLabel = useCountdownLabel(m.nextFundingTime);
  const sim = m.sources.klines === "sim" && m.sources.metrics === "sim";
  const partial = !sim && (m.sources.price === "sim" || m.sources.liq === "sim");

  return (
    <header className="relative z-10 border-b border-line/70 bg-ink-900/70 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        {/* marca */}
        <div className="flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#0a1526" stroke="#2b426e" />
            <path d="M6 22 L12 14 L17 18 L26 7" stroke="#2fd6a5" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="26" cy="7" r="3" fill="#ff4d6d" />
          </svg>
          <div>
            <div className="font-display text-[17px] font-900 leading-none tracking-tight text-fog">
              LIQ<span className="text-long">RADAR</span>
            </div>
            <div className="panel-tag mt-1">mapa de liquidaciones · btc</div>
          </div>
        </div>

        {/* precio en vivo */}
        <div className="flex items-baseline gap-3">
          <span className="panel-tag">BTC/USDT</span>
          <span
            key={m.tickId}
            className={`font-mono text-3xl font-700 tabular-nums sm:text-4xl ${up ? "flash-up" : "flash-down"}`}
          >
            {fmtUsd(m.spot, 1)}
          </span>
          <span
            className={`font-mono text-sm font-600 tabular-nums ${
              m.change24h >= 0 ? "text-long" : "text-short"
            }`}
          >
            {m.change24h >= 0 ? "▲" : "▼"} {Math.abs(m.change24h).toFixed(2)}% 24h
          </span>
        </div>

        {/* métricas rápidas */}
        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[12px] tabular-nums">
          <div>
            <div className="panel-tag" title="Convención contrarian: funding positivo = multitud long = presión bajista (rojo)">funding</div>
            <div className={m.fundingRate >= 0 ? "text-short" : "text-long"}>
              {(m.fundingRate * 100).toFixed(4)}% <span className="text-dusk">· {fundingLabel}</span>
            </div>
          </div>
          <div>
            <div className="panel-tag">OI</div>
            <div className="text-fog">
              {m.oi > 0 ? m.oi.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " BTC" : "—"}
              <span className={m.oiChange24h >= 0 ? "ml-1 text-long" : "ml-1 text-short"}>
                {m.oiChange24h >= 0 ? "+" : ""}
                {m.oiChange24h.toFixed(1)}%
              </span>
            </div>
          </div>
          <div>
            <div className="panel-tag">L/S cuentas</div>
            <div className="text-fog">{m.globalRatio.toFixed(2)}</div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5">
            <span
              className="live-dot"
              style={{
                background: sim ? "#ffb547" : partial ? "#3fb6ff" : "#2fd6a5",
                color: sim ? "#ffb547" : partial ? "#3fb6ff" : "#2fd6a5",
              }}
            />
            <span className={`font-600 tracking-widest ${sim ? "text-warn" : partial ? "text-pulse" : "text-long"}`}>
              {sim ? "SIMULADO" : partial ? "PARCIAL" : "EN VIVO"}
            </span>
          </div>
          <button
            onClick={onToggleSound}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] font-700 tracking-widest transition-all ${
              soundOn
                ? "border-long/60 bg-long/10 text-long-hi hover:bg-long/20"
                : "border-line text-dusk hover:border-line/90 hover:text-mist"
            }`}
            title={soundOn ? "Alertas sonoras activadas (giros de rumbo y zonas magnéticas)" : "Activar alertas sonoras"}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M1.5 5v4h2.4L7 12V2L3.9 5H1.5Z" fill="currentColor" />
              {soundOn ? (
                <>
                  <path d="M9 4.5a3.4 3.4 0 0 1 0 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M10.8 2.8a6 6 0 0 1 0 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </>
              ) : (
                <path d="M9 5.2l3.6 3.6M12.6 5.2 9 8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              )}
            </svg>
            {soundOn ? "SONIDO" : "MUDO"}
          </button>
        </div>
      </div>

      {/* cinta de datos */}
      <div className="overflow-hidden border-t border-line/60 bg-ink-950/60 py-1.5">
        <div className="tape-track font-mono text-[11px] tracking-wide text-mist">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center gap-11 pr-11">
              <span>◆ MÁX 24H <b className="text-fog">{m.high24h ? fmtUsd(m.high24h) : "—"}</b></span>
              <span>◆ MÍN 24H <b className="text-fog">{m.low24h ? fmtUsd(m.low24h) : "—"}</b></span>
              <span>◆ VOL 24H <b className="text-fog">{m.quoteVolume24h ? "$" + (m.quoteVolume24h / 1e9).toFixed(2) + "B" : "—"}</b></span>
              <span>◆ FUNDING <b className={m.fundingRate >= 0 ? "text-short" : "text-long"}>{(m.fundingRate * 100).toFixed(4)}%</b></span>
              <span>◆ OI 24H <b className={m.oiChange24h >= 0 ? "text-long" : "text-short"}>{m.oiChange24h >= 0 ? "+" : ""}{m.oiChange24h.toFixed(1)}%</b></span>
              <span>◆ RATIO RETAIL <b className="text-fog">{m.globalRatio.toFixed(2)}</b></span>
              <span>◆ RATIO TOP <b className="text-fog">{m.topRatio.toFixed(2)}</b></span>
              <span>◆ LONGS LIQ. SESIÓN <b className="text-long">{fmtUsd(m.sessionLong)}</b></span>
              <span>◆ SHORTS LIQ. SESIÓN <b className="text-short">{fmtUsd(m.sessionShort)}</b></span>
              <span className="text-dusk">los pools de liquidez actúan como imanes de precio</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
