import { useEffect, useState } from "react";
import { fmtUsd } from "../lib/engine";

export interface FlipInfo {
  dir: "up" | "down";
  at: number;
  spot: number;
  target: number | null;
}

/* Notificación prominente cuando el radar cambia de rumbo LONG ↔ SHORT */
export function FlipAlert({ flip, onDismiss }: { flip: FlipInfo | null; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!flip) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const hide = setTimeout(() => setVisible(false), 7000);
    return () => clearTimeout(hide);
  }, [flip]);

  if (!flip) return null;

  const up = flip.dir === "up";
  const color = up ? "#2fd6a5" : "#ff4d6d";

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-5 z-50 w-[min(560px,92vw)] -translate-x-1/2 transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, ${visible ? "0" : "-18px"})`,
      }}
      aria-live="polite"
    >
      <div
        className="pointer-events-auto flex items-center gap-4 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur-sm"
        style={{
          borderColor: `${color}66`,
          background: `linear-gradient(120deg, ${up ? "rgba(10,32,27,0.94)" : "rgba(38,12,20,0.94)"}, rgba(7,16,31,0.96))`,
          boxShadow: `0 18px 50px -12px ${color}40, inset 0 1px 0 ${color}22`,
        }}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
          style={{ background: `${color}1a`, border: `1px solid ${color}55` }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden style={{ transform: up ? "none" : "rotate(180deg)" }}>
            <path d="M10 16V4M10 4l-4.5 4.5M10 4l4.5 4.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9.5px] font-700 tracking-[0.2em]" style={{ color }}>
              CAMBIO DE RUMBO
            </span>
            <span className="font-mono text-[9px] text-dusk">
              {new Date(flip.at).toLocaleTimeString("es-ES")}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[13.5px] leading-snug text-fog">
            El radar giró a{" "}
            <b style={{ color }}>{up ? "LONG (alcista)" : "SHORT (bajista)"}</b>
            {flip.target && (
              <span className="text-mist">
                {" "}· imán en <b className="font-mono tabular-nums" style={{ color }}>{fmtUsd(flip.target)}</b>
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-line p-1.5 text-mist transition-colors hover:border-line hover:text-fog"
          aria-label="Cerrar alerta"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
