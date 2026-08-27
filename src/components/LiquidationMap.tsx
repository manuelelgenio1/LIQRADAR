import { useMemo, useState } from "react";
import type { Cluster, LiqBin } from "../lib/engine";
import { fmtCompact, fmtUsd, LEV_COLORS, liqDistance } from "../lib/engine";
import { TF_CONFIG, type Timeframe } from "../hooks/useMarket";

interface Props {
  bins: LiqBin[];
  clusters: Cluster[];
  spot: number;
  longPool: number;
  shortPool: number;
  tf: Timeframe;
  onTf: (t: Timeframe) => void;
  levs: number[];
  onLevs: (l: number[]) => void;
}

const ALL_LEVS = [10, 25, 50, 100];

/* #rrggbb + alpha → rgba() */
const hexA = (hex: string, a: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

export function LiquidationMap({ bins, clusters, spot, longPool, shortPool, tf, onTf, levs, onLevs }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const hi = bins.length ? bins[0].price : spot * 1.05;
  const lo = bins.length ? bins[bins.length - 1].price : spot * 0.95;
  const spotPct = hi > lo ? ((hi - spot) / (hi - lo)) * 100 : 50;

  const clusterIdx = useMemo(() => {
    const step = (hi - lo) / Math.max(bins.length, 1);
    const map = new Map<number, Cluster>();
    clusters.slice(0, 6).forEach((c) => {
      const i = Math.min(bins.length - 1, Math.max(0, Math.round((hi - c.price) / step - 0.5)));
      map.set(i, c);
    });
    return map;
  }, [clusters, bins.length, hi, lo]);

  const total = longPool + shortPool || 1;
  const longPct = (longPool / total) * 100;

  const toggleLev = (l: number) => {
    if (levs.includes(l)) {
      if (levs.length > 1) onLevs(levs.filter((x) => x !== l));
    } else {
      onLevs([...levs, l].sort((a, b) => a - b));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">02 · mapa de calor</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Dónde se acumula la liquidación?
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-mist">
            Cada barra es un nivel de precio donde se concentran liquidaciones estimadas, <b className="text-fog">coloreada por apalancamiento</b>:{" "}
            <span style={{ color: LEV_COLORS[10] }}>10×</span>, <span style={{ color: LEV_COLORS[25] }}>25×</span>,{" "}
            <span style={{ color: LEV_COLORS[50] }}>50×</span> y <span style={{ color: LEV_COLORS[100] }}>100×</span>.{" "}
            El <span className="text-long-hi">tick verde</span> marca longs (abajo) y el <span className="text-short-hi">rojo</span> shorts (arriba).
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            {(Object.keys(TF_CONFIG) as Timeframe[]).map((t) => (
              <button
                key={t}
                title={`${TF_CONFIG[t].label} · ${TF_CONFIG[t].desc} · velas de ${TF_CONFIG[t].interval}`}
                className={`chip ${tf === t ? "on" : ""}`}
                onClick={() => onTf(t)}
              >
                {TF_CONFIG[t].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="panel-tag">apalancamiento</span>
            {ALL_LEVS.map((l) => {
              const on = levs.includes(l);
              const col = LEV_COLORS[l];
              return (
                <button
                  key={l}
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => toggleLev(l)}
                  style={on ? { borderColor: hexA(col, 0.7), color: col, background: hexA(col, 0.1), boxShadow: `0 0 16px -6px ${hexA(col, 0.6)}` } : undefined}
                  title={`Liquidaciones a ${l}× (≈ ${(liqDistance(l) * 100).toFixed(1)}% del precio)`}
                >
                  <i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: on ? col : "#3a4a6b" }} />
                  {l}×
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* balance de pools */}
      <div>
        <div className="mb-1.5 flex justify-between font-mono text-[11px] tabular-nums">
          <span className="text-long-hi">
            LIQ. LONGS ABAJO · {fmtCompact(longPool)} ({longPct.toFixed(0)}%)
          </span>
          <span className="text-short-hi">
            ({(100 - longPct).toFixed(0)}%) {fmtCompact(shortPool)} · LIQ. SHORTS ARRIBA
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-sm border border-line/60">
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${longPct}%`, background: "linear-gradient(90deg,#157a5c,#2fd6a5)" }}
          />
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${100 - longPct}%`, background: "linear-gradient(90deg,#8f1f36,#ff4d6d)" }}
          />
        </div>
      </div>

      {/* mapa */}
      {bins.length === 0 ? (
        <div className="flex h-[420px] animate-pulse items-center justify-center rounded-md border border-line/50 font-mono text-xs text-dusk">
          CARGANDO MAPA DE LIQUIDACIÓN…
        </div>
      ) : (
        <div className="relative">
          <div className="flex flex-col gap-[2px]">
            {bins.map((b, i) => {
              const c = clusterIdx.get(i);
              const hovered = hover === i;
              return (
                <div
                  key={i}
                  className="group relative flex h-[9px] cursor-crosshair items-center gap-2"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span
                    className={`w-[72px] shrink-0 text-right font-mono text-[9.5px] tabular-nums ${
                      hovered ? "text-fog" : "text-dusk"
                    }`}
                  >
                    {Math.round(b.price).toLocaleString("en-US")}
                  </span>
                  {/* tick de lado: verde = longs (bajo el spot) · rojo = shorts (arriba) */}
                  <span
                    className="h-[9px] w-[3px] shrink-0 rounded-full"
                    style={{ background: b.side === "long" ? "#2fd6a5" : "#ff4d6d", opacity: 0.95 }}
                    title={b.side === "long" ? "Liquidación de LONGS" : "Liquidación de SHORTS"}
                  />
                  <div className="relative h-full flex-1 overflow-hidden rounded-[2px] bg-ink-950/70">
                    <div
                      className="heat-bar absolute inset-y-0 left-0 flex overflow-hidden rounded-[2px]"
                      style={{
                        width: `${Math.max(b.intensity * 100, b.intensity > 0.02 ? 1.5 : 0)}%`,
                        boxShadow:
                          b.intensity > 0.72
                            ? b.side === "long"
                              ? "0 0 14px -2px rgba(47,214,165,0.7)"
                              : "0 0 14px -2px rgba(255,77,109,0.7)"
                            : "none",
                        animationDelay: `${i * 9}ms`,
                      }}
                    >
                      {(() => {
                        const totalV = b.parts.reduce((a, p) => a + p.v, 0) || 1;
                        return b.parts.map((p) => (
                          <div
                            key={p.lev}
                            style={{
                              width: `${(p.v / totalV) * 100}%`,
                              background: hexA(LEV_COLORS[p.lev] ?? "#93a5c8", 0.3 + 0.7 * p.v),
                            }}
                          />
                        ));
                      })()}
                    </div>
                    {hovered && (
                      <div className="pointer-events-none absolute left-1/2 top-[-46px] z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-ink-900/95 px-3 py-1.5 font-mono text-[10.5px] tabular-nums shadow-xl">
                        <div>
                          <span className={b.side === "long" ? "text-long-hi" : "text-short-hi"}>
                            {b.side === "long" ? "LIQ LONGS" : "LIQ SHORTS"}
                          </span>{" "}
                          <span className="text-fog">{fmtUsd(b.price)}</span>{" "}
                          <span className="text-dusk">· {fmtCompact(b.estNotional)} est. · </span>
                          <span className="text-mist">{(((b.price - spot) / spot) * 100).toFixed(2)}%</span>
                        </div>
                        {b.parts.length > 0 && (
                          <div className="mt-1 flex items-center gap-2.5 border-t border-line/50 pt-1">
                            {(() => {
                              const totalV = b.parts.reduce((a, p) => a + p.v, 0) || 1;
                              return b.parts.map((p) => (
                                <span key={p.lev} className="flex items-center gap-1">
                                  <i className="h-1.5 w-1.5 rounded-full" style={{ background: LEV_COLORS[p.lev] }} />
                                  <span style={{ color: LEV_COLORS[p.lev] }}>{p.lev}×</span>
                                  <span className="text-dusk">{fmtCompact(b.estNotional * (p.v / totalV))}</span>
                                </span>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="w-[118px] shrink-0 font-mono text-[9.5px] tabular-nums">
                    {c && (
                      <span className={c.side === "long" ? "text-long-hi" : "text-short-hi"}>
                        <b>{c.tag}</b> {fmtCompact(c.estNotional)} · {c.distancePct.toFixed(1)}%
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* línea de precio spot */}
          <div
            className="pointer-events-none absolute left-[80px] right-[126px] z-10"
            style={{ top: `calc(${spotPct}% * 0.975)` }}
          >
            <div className="relative border-t-2 border-dashed border-warn/90">
              <span className="absolute -top-[11px] right-0 rounded-sm bg-warn px-1.5 py-[1px] font-mono text-[9px] font-700 text-ink-950">
                SPOT {fmtUsd(spot)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* leyenda inferior */}
      <div className="flex flex-col gap-2 border-t border-line/50 pt-3 font-mono text-[10.5px] text-dusk">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="panel-tag">por apalancamiento</span>
          {ALL_LEVS.map((l) => (
            <span key={l} className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-sm" style={{ background: LEV_COLORS[l] }} />
              <b style={{ color: LEV_COLORS[l] }}>{l}×</b>
              <span>≈ {(liqDistance(l) * 100).toFixed(1)}%</span>
            </span>
          ))}
          <span className="ml-auto">de frío (10×) a explosivo (100×)</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="panel-tag">lado (tick)</span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-[3px] rounded-full bg-long" /> verde = liq. de LONGS (bajo el spot · combustible bajista)
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-[3px] rounded-full bg-short" /> rojo = liq. de SHORTS (sobre el spot · combustible alcista)
          </span>
          <span className="ml-auto">liquidación = entrada ± (1/L − 0.40% MMR tier 1)</span>
        </div>
      </div>
    </div>
  );
}
