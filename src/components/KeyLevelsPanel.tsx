import { useMemo, useState } from "react";
import type { KeyLevel } from "../lib/levels";
import { KIND_COLOR } from "../lib/levels";
import { fmtUsd } from "../lib/engine";

type Group = "todos" | "estructura" | "fib" | "pivote";

const GROUPS: { id: Group; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "estructura", label: "Estructura" },
  { id: "fib", label: "Fibonacci" },
  { id: "pivote", label: "Pivotes" },
];

export function KeyLevelsPanel({ levels, spot }: { levels: KeyLevel[]; spot: number }) {
  const [group, setGroup] = useState<Group>("todos");

  const filtered = useMemo(
    () => levels.filter((l) => group === "todos" || l.group === group),
    [levels, group]
  );

  const nearestAbove = useMemo(
    () => filtered.filter((l) => l.price > spot).sort((a, b) => a.price - b.price)[0] ?? null,
    [filtered, spot]
  );
  const nearestBelow = useMemo(
    () => filtered.filter((l) => l.price < spot).sort((a, b) => b.price - a.price)[0] ?? null,
    [filtered, spot]
  );

  return (
    <div className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">M2 · niveles clave · estructura objetiva</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Soportes, resistencias y Fibonacci
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-mist">
            A diferencia del mapa de liquidación (una estimación), estos niveles son{" "}
            <b className="text-fog">objetivos</b>: se derivan directamente de las velas. Úsalos como zonas donde el
            precio reacciona — y donde suelen vivir los clusters de liquidación.
          </p>
        </div>
        <div className="flex gap-1.5">
          {GROUPS.map((g) => (
            <button key={g.id} className={`chip ${group === g.id ? "on" : ""}`} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* nivel más cercano arriba / abajo */}
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border border-short/40 bg-short/[0.06] px-4 py-3 transition-transform duration-200 hover:-translate-y-0.5">
          <div>
            <div className="panel-tag">resistencia más cercana</div>
            <div className="mt-0.5 font-mono text-xl font-700 tabular-nums text-short-hi">
              {nearestAbove ? fmtUsd(nearestAbove.price) : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] text-short-hi">{nearestAbove ? nearestAbove.short : ""}</div>
            <div className="font-mono text-[11px] tabular-nums text-mist">
              {nearestAbove ? `+${nearestAbove.distancePct.toFixed(2)}%` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-long/40 bg-long/[0.06] px-4 py-3 transition-transform duration-200 hover:-translate-y-0.5">
          <div>
            <div className="panel-tag">soporte más cercano</div>
            <div className="mt-0.5 font-mono text-xl font-700 tabular-nums text-long-hi">
              {nearestBelow ? fmtUsd(nearestBelow.price) : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] text-long-hi">{nearestBelow ? nearestBelow.short : ""}</div>
            <div className="font-mono text-[11px] tabular-nums text-mist">
              {nearestBelow ? `${nearestBelow.distancePct.toFixed(2)}%` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* escalera de niveles */}
      <div className="slim-scroll mt-4 flex-1 space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 360, minHeight: 220 }}>
        {filtered.map((l) => {
          const isNearest = l === nearestAbove || l === nearestBelow;
          const color = KIND_COLOR[l.kind];
          return (
            <div
              key={`${l.short}-${l.price.toFixed(0)}`}
              className={`group flex items-center gap-3 rounded-md border px-3 py-1.5 font-mono text-[12px] tabular-nums transition-all duration-150 hover:translate-x-1 ${
                isNearest ? "border-warn/60 bg-warn/[0.07]" : "border-line/40 bg-ink-950/30 hover:border-line"
              }`}
            >
              <span
                className="w-10 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[9.5px] font-700 tracking-wider"
                style={{ color, border: `1px solid ${color}55`, background: `${color}12` }}
              >
                {l.short}
              </span>
              <span className="flex-1 truncate text-[11px] text-mist">{l.label}</span>
              {isNearest && <span className="live-dot shrink-0" style={{ background: "#ffb547", color: "#ffb547" }} />}
              <span className="w-24 text-right font-600" style={{ color }}>
                {fmtUsd(l.price)}
              </span>
              <span className="w-16 text-right text-[10.5px] text-dusk">
                {l.distancePct >= 0 ? "+" : ""}
                {l.distancePct.toFixed(2)}%
              </span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-line/60 font-mono text-[11px] text-dusk">
            CARGANDO NIVELES…
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line/50 pt-3 font-mono text-[10.5px] text-dusk">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-short" /> resistencia (sobre el spot)</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-long" /> soporte (bajo el spot)</span>
        <span className="ml-auto">los niveles se recalculan con cada vela</span>
      </div>
    </div>
  );
}
