import { useEffect } from "react";
import { fmtUsd } from "../lib/engine";

export interface SniperInfo {
  dir: "up" | "down";
  at: number;
  spot: number;
  target: number | null;
  confidence: number;
  score: number;
}

/* Toast francotirador: señal de alta convicción (sesgo + confianza sobre umbral) */
export function SniperToast({ s, onDismiss }: { s: SniperInfo | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!s) return;
    const id = setTimeout(onDismiss, 9000);
    return () => clearTimeout(id);
  }, [s, onDismiss]);

  if (!s) return null;
  const up = s.dir === "up";
  const c = up ? "#2fd6a5" : "#ff4d6d";

  return (
    <div
      className="fixed right-4 top-20 z-50 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border shadow-2xl"
      style={{
        borderColor: `${c}66`,
        background: "linear-gradient(165deg, rgba(13,26,48,0.97), rgba(7,16,31,0.98))",
        boxShadow: `0 18px 50px -12px rgba(2,6,16,0.9), 0 0 34px -8px ${c}55`,
        animation: "feedIn 0.4s cubic-bezier(.2,.9,.3,1) both",
      }}
      role="status"
    >
      <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${c}, transparent)` }} />
      <div className="flex items-start gap-3 p-4">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden className="mt-0.5 shrink-0">
          <circle cx="15" cy="15" r="10.5" fill="none" stroke={c} strokeWidth="1.6" />
          <circle cx="15" cy="15" r="4.5" fill="none" stroke={c} strokeWidth="1.4" />
          <path d="M15 1.5v6M15 22.5v6M1.5 15h6M22.5 15h6" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="15" cy="15" r="1.4" fill={c} />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-700 tracking-[0.2em]" style={{ color: c }}>
            SEÑAL FRANCOTIRADOR
          </div>
          <div className="font-display mt-0.5 text-xl font-900 leading-none" style={{ color: c, textShadow: `0 0 18px ${c}55` }}>
            {up ? "LONG" : "SHORT"}
          </div>
          <div className="mt-1.5 font-mono text-[11px] tabular-nums leading-relaxed text-mist">
            sesgo <b style={{ color: c }}>{s.score > 0 ? "+" : ""}{s.score}</b> · confianza{" "}
            <b className="text-fog">{s.confidence}%</b>
            <br />
            spot {fmtUsd(s.spot, 1)} → imán{" "}
            <b className="text-fog">{s.target ? fmtUsd(s.target) : "—"}</b>
          </div>
          <div className="mt-1 font-mono text-[9.5px] text-dusk">
            {new Date(s.at).toLocaleTimeString("es-ES")} · umbral superado
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="rounded p-1 font-mono text-dusk transition-colors hover:bg-line/40 hover:text-fog"
          aria-label="cerrar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
