import { useSyncExternalStore } from "react";
import { getSources, getDataTruthVersion, subscribeDataTruth, TRUTH_META, type TruthState } from "../lib/dataTruth";

/* Panel Data Truth: cada métrica declara su fuente REAL / ESTIMADA / SIN DATOS.
   Nunca se convierte "desconocido" en dato de mercado. */

function ago(ms: number): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  return `hace ${m}min`;
}

export function DataTruthPanel() {
  useSyncExternalStore(subscribeDataTruth, getDataTruthVersion);
  const sources = getSources();
  const counts: Record<TruthState, number> = { real: 0, estimated: 0, unavailable: 0, connecting: 0 };
  for (const s of sources) counts[s.state]++;

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">data truth · proveniencia de los datos</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Qué es real y qué es estimado?
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            Cada métrica declara su fuente. <b className="text-long-hi">REAL</b> = observado del exchange ·{" "}
            <b className="text-warn">ESTIMADO</b> = modelo (clusters futuros, absorción, IV) ·{" "}
            <b className="text-short-hi">SIN DATOS</b> = la señal se degrada, nunca se inventa.
          </p>
        </div>
        <div className="flex gap-2 font-mono text-[10px]">
          {(Object.keys(counts) as TruthState[]).map((k) => (
            <span
              key={k}
              className="rounded-md border px-2 py-1 tabular-nums"
              style={{ borderColor: `${TRUTH_META[k].color}55`, background: `${TRUTH_META[k].color}10`, color: TRUTH_META[k].color }}
            >
              {TRUTH_META[k].label} {counts[k]}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {sources.map((s) => {
          const meta = TRUTH_META[s.state];
          return (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg border border-line/60 bg-ink-950/40 px-3.5 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.state === "real" ? "live-dot" : ""}`}
                style={{ background: meta.color, color: meta.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-600 text-fog">{s.label}</div>
                <div className="truncate font-mono text-[9.5px] text-dusk">{s.note ?? ago(s.lastUpdate)}</div>
              </div>
              <span
                className="shrink-0 rounded-sm px-2 py-0.5 font-mono text-[9px] font-700 tracking-wider"
                style={{ color: meta.color, background: `${meta.color}12`, border: `1px solid ${meta.color}44` }}
              >
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 border-t border-line/40 pt-2.5 font-mono text-[10px] leading-relaxed text-dusk">
        Los <b className="text-warn">clusters de liquidación futura</b> son siempre estimaciones: ninguna API pública revela
        precio de entrada, apalancamiento y margen de cada posición. La microestructura histórica (L2/trades) solo existe
        desde que arrancó la captura — no se inventa retrohistórico.
      </p>
    </div>
  );
}
