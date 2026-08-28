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

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

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

  // rango del medidor: del soporte más cercano a la resistencia más cercana
  const lo = nearestBelow ? nearestBelow.price : spot * 0.985;
  const hi = nearestAbove ? nearestAbove.price : spot * 1.015;
  const span = hi - lo || 1;
  const spotPct = clampPct(((spot - lo) / span) * 100);
  const toRes = nearestAbove ? ((nearestAbove.price - spot) / spot) * 100 : null;
  const toSup = nearestBelow ? ((spot - nearestBelow.price) / spot) * 100 : null;

  return (
    <div className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">M2 · niveles clave · estructura objetiva</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Soportes, resistencias y Fibonacci
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-mist">
            Niveles <b className="text-fog">objetivos</b> derivados de las velas (sin estimación): zonas donde el precio
            reacciona y donde suelen vivir los clusters de liquidación.
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

      {/* ══ medidor de posición: ¿dónde está el precio en la zona S/R? ══ */}
      <div className="mt-4 rounded-lg border border-line/70 bg-ink-950/50 p-4">
        <div className="flex items-center justify-between">
          <span className="panel-tag">posición del precio en la zona</span>
          <span className="font-mono text-[10.5px] tabular-nums text-mist">
            {spotPct.toFixed(0)}% del camino{" "}
            <b className={spotPct >= 50 ? "text-short-hi" : "text-long-hi"}>
              {spotPct >= 50 ? "→ hacia la resistencia" : "→ hacia el soporte"}
            </b>
          </span>
        </div>

        <div className="relative mt-4 h-10">
          {/* pista con degradado soporte→resistencia */}
          <div
            className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
            style={{ background: "linear-gradient(90deg,#157a5c,#1d3a33 30%,#15233c 50%,#3a2530 70%,#8f1f36)" }}
          />
          {/* ticks de todos los niveles del grupo */}
          {filtered.map((l) => {
            const p = clampPct(((l.price - lo) / span) * 100);
            return (
              <div
                key={`tick-${l.short}-${l.price.toFixed(0)}`}
                className="absolute top-1/2 h-4 w-px -translate-y-1/2 opacity-60"
                style={{ left: `${p}%`, background: KIND_COLOR[l.kind] }}
                title={`${l.short} · ${fmtUsd(l.price)}`}
              />
            );
          })}
          {/* marcador del spot */}
          <div className="absolute top-0 z-10 -translate-x-1/2" style={{ left: `${spotPct}%` }}>
            <div className="mx-auto flex h-10 w-[3px] flex-col items-center justify-center">
              <span className="font-mono text-[9px] font-700 tabular-nums text-warn">SPOT</span>
              <div className="mt-0.5 h-5 w-[3px] rounded-full bg-warn shadow-[0_0_10px_rgba(255,181,71,0.9)]" />
            </div>
          </div>
        </div>

        {/* extremos: soporte y resistencia más cercanos */}
        <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] tabular-nums">
          <span className="text-long-hi">
            ▲ {nearestBelow ? nearestBelow.short : "SOPORTE"} · {fmtUsd(lo)}
            {toSup !== null && <span className="ml-1 text-dusk">({toSup.toFixed(2)}% abajo)</span>}
          </span>
          <span className="text-short-hi">
            {toRes !== null && <span className="mr-1 text-dusk">({toRes.toFixed(2)}% arriba)</span>}
            {nearestAbove ? nearestAbove.short : "RESISTENCIA"} · {fmtUsd(hi)} ▼
          </span>
        </div>
      </div>

      {/* escalera de niveles */}
      <div className="slim-scroll mt-4 flex-1 space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 320, minHeight: 200 }}>
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
    </div>
  );
}
