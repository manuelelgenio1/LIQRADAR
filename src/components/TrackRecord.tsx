import type { Prediction } from "../lib/history";
import { trackStats } from "../lib/history";
import { fmtUsd } from "../lib/engine";

const STATUS_STYLE: Record<Prediction["status"], { label: string; color: string; bg: string; border: string }> = {
  acierto: { label: "ACIERTO", color: "#5ef2c4", bg: "rgba(47,214,165,0.12)", border: "rgba(47,214,165,0.45)" },
  fallo: { label: "FALLO", color: "#ff7d95", bg: "rgba(255,77,109,0.13)", border: "rgba(255,77,109,0.45)" },
  abierta: { label: "ABIERTA", color: "#3fb6ff", bg: "rgba(63,182,255,0.1)", border: "rgba(63,182,255,0.4)" },
  caducada: { label: "CADUCADA", color: "#8fa1c4", bg: "rgba(143,161,196,0.08)", border: "rgba(143,161,196,0.3)" },
};

export function TrackRecord({ preds, spot }: { preds: Prediction[]; spot: number }) {
  const s = trackStats(preds);
  const R = 40;
  const C = 2 * Math.PI * R;
  const rate = s.hitRate ?? 0;

  return (
    <div className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="panel-tag">08 · historial del modelo</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog">¿Cuánto acierta el radar?</h2>
        </div>
        <div className="flex gap-1.5">
          <button
            className="chip"
            onClick={() => {
              if (preds.length === 0) return;
              const rows = [
                "fecha,hora,veredicto,direccion,spot,objetivo,confianza,estado,nota",
                ...preds.map((p) => {
                  const d = new Date(p.time);
                  return [
                    d.toLocaleDateString("es-ES"),
                    d.toLocaleTimeString("es-ES"),
                    p.headline,
                    p.direction,
                    p.spot.toFixed(2),
                    p.target?.toFixed(2) ?? "",
                    p.confidence,
                    p.status,
                    `"${(p.note ?? "").replace(/"/g, "'")}"`,
                  ].join(",");
                }),
              ].join("\n");
              const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `liqradar-historial-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            exportar csv
          </button>
          <button
            className="chip"
            onClick={() => {
              try {
                localStorage.removeItem("liqradar-preds-v2");
              } catch { /* noop */ }
              window.location.reload();
            }}
          >
            reiniciar
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-5 rounded-lg border border-line/70 bg-ink-950/50 p-4">
        {/* tasa de acierto */}
        <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
          <svg width="104" height="104" viewBox="0 0 104 104">
            <circle cx="52" cy="52" r={R} fill="none" stroke="#15233c" strokeWidth="8" />
            <circle
              cx="52"
              cy="52"
              r={R}
              fill="none"
              stroke={s.hitRate === null ? "#5d7099" : rate >= 50 ? "#2fd6a5" : "#ff4d6d"}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - rate / 100)}
              transform="rotate(-90 52 52)"
              style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.25,1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-xl font-700 tabular-nums text-fog">
              {s.hitRate === null ? "—" : `${Math.round(rate)}%`}
            </span>
            <span className="panel-tag mt-0.5">acierto</span>
          </div>
        </div>

        <div className="min-w-[150px] flex-1">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[12px] tabular-nums">
            <span className="text-dusk">aciertos</span>
            <span className="text-right font-700 text-long-hi">{s.hits}</span>
            <span className="text-dusk">fallos</span>
            <span className="text-right font-700 text-short-hi">{s.misses}</span>
            <span className="text-dusk">abiertas</span>
            <span className="text-right font-700 text-pulse">{s.open}</span>
            <span className="text-dusk">caducadas</span>
            <span className="text-right font-700 text-mist">{s.expired}</span>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-dusk">
            {s.hitRate === null
              ? "Cada veredicto con sesgo se guarda y se verifica contra el precio real: objetivo tocado = acierto, invalidación barrida = fallo."
              : `De ${s.hits + s.misses} predicciones cerradas, ${s.hits} alcanzaron su objetivo antes que la invalidación. Persisten en tu navegador.`}
          </p>
        </div>
      </div>

      {/* lista */}
      <div className="slim-scroll mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 300, minHeight: 120 }}>
        {preds.length === 0 && (
          <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-line/70 font-mono text-[11px] text-dusk">
            AÚN SIN PREDICCIONES REGISTRADAS…
          </div>
        )}
        {preds.slice(0, 12).map((p) => {
          const st = STATUS_STYLE[p.status];
          const progress =
            p.status === "abierta" && p.target !== null && p.spot !== p.target
              ? Math.min(100, Math.max(0, ((p.spot - spot) / (p.spot - p.target)) * 100))
              : null;
          return (
            <div
              key={p.id}
              className="feed-in rounded-md border border-line/50 bg-ink-950/40 px-3 py-2 transition-colors hover:border-line"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-700 tracking-wider"
                  style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}
                >
                  {st.label}
                </span>
                <span className={`font-mono text-[11px] font-700 ${p.direction === "up" ? "text-long-hi" : "text-short-hi"}`}>
                  {p.headline}
                </span>
                <span className="font-mono text-[10.5px] tabular-nums text-mist">
                  @{fmtUsd(p.spot)} → {p.target !== null ? fmtUsd(p.target) : "—"}
                </span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-dusk">
                  {new Date(p.time).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  <span className="ml-2 text-mist">{p.confidence}%</span>
                </span>
              </div>
              {p.note && <div className="mt-1 font-mono text-[10px] text-dusk">▸ {p.note}</div>}
              {progress !== null && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-900">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${progress}%`,
                      background: p.direction === "up" ? "#2fd6a5" : "#ff4d6d",
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
