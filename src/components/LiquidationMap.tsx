import { useMemo, useState } from "react";
import type { Cluster, LiqBin } from "../lib/engine";
import { fmtCompact, fmtUsd } from "../lib/engine";
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
            Cada barra es un nivel de precio donde se concentran liquidaciones estimadas.{" "}
            <span className="text-short-hi">Rosa = longs liquidados (abajo)</span> ·{" "}
            <span className="text-long-hi">Verde = shorts liquidados (arriba)</span>. El precio suele barrer estas zonas.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1.5">
            {(Object.keys(TF_CONFIG) as Timeframe[]).map((t) => (
              <button key={t} className={`chip ${tf === t ? "on" : ""}`} onClick={() => onTf(t)}>
                {TF_CONFIG[t].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="panel-tag">apalancamiento</span>
            {ALL_LEVS.map((l) => (
              <button key={l} className={`chip ${levs.includes(l) ? "on" : ""}`} onClick={() => toggleLev(l)}>
                {l}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* balance de pools */}
      <div>
        <div className="mb-1.5 flex justify-between font-mono text-[11px] tabular-nums">
          <span className="text-short-hi">
            LIQ. LONGS ABAJO · {fmtCompact(longPool)} ({longPct.toFixed(0)}%)
          </span>
          <span className="text-long-hi">
            ({(100 - longPct).toFixed(0)}%) {fmtCompact(shortPool)} · LIQ. SHORTS ARRIBA
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-sm border border-line/60">
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${longPct}%`, background: "linear-gradient(90deg,#8f1f36,#ff4d6d)" }}
          />
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${100 - longPct}%`, background: "linear-gradient(90deg,#2fd6a5,#157a5c)" }}
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
                  <div className="relative h-full flex-1 overflow-visible rounded-[2px] bg-ink-950/70">
                    <div
                      className="heat-bar absolute inset-y-0 left-0 rounded-[2px]"
                      style={{
                        width: `${Math.max(b.intensity * 100, b.intensity > 0.02 ? 1.5 : 0)}%`,
                        background:
                          b.side === "long"
                            ? `linear-gradient(90deg, rgba(255,77,109,${0.25 + b.intensity * 0.75}), rgba(255,77,109,${0.06 + b.intensity * 0.3}))`
                            : `linear-gradient(90deg, rgba(47,214,165,${0.25 + b.intensity * 0.75}), rgba(47,214,165,${0.06 + b.intensity * 0.3}))`,
                        boxShadow:
                          b.intensity > 0.72
                            ? b.side === "long"
                              ? "0 0 14px -2px rgba(255,77,109,0.8)"
                              : "0 0 14px -2px rgba(47,214,165,0.8)"
                            : "none",
                        animationDelay: `${i * 9}ms`,
                      }}
                    />
                    {hovered && (
                      <div className="pointer-events-none absolute left-1/2 top-[-34px] z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-ink-900/95 px-3 py-1.5 font-mono text-[10.5px] tabular-nums shadow-xl">
                        <span className={b.side === "long" ? "text-short-hi" : "text-long-hi"}>
                          {b.side === "long" ? "LIQ LONGS" : "LIQ SHORTS"}
                        </span>{" "}
                        <span className="text-fog">{fmtUsd(b.price)}</span>{" "}
                        <span className="text-dusk">· {fmtCompact(b.estNotional)} est. · </span>
                        <span className="text-mist">{(((b.price - spot) / spot) * 100).toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                  <span className="w-[118px] shrink-0 font-mono text-[9.5px] tabular-nums">
                    {c && (
                      <span className={c.side === "long" ? "text-short-hi" : "text-long-hi"}>
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
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line/50 pt-3 font-mono text-[10.5px] text-dusk">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-short" /> debajo del precio → liquidación de LONGS (combustible bajista)
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-long" /> encima del precio → liquidación de SHORTS (combustible alcista)
        </span>
        <span className="ml-auto">liquidación = entrada ± (1/L − 0.40% MMR tier 1) · ponderado por volumen y mechas</span>
      </div>
    </div>
  );
}
