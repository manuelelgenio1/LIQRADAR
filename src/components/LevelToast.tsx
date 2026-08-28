export interface LevelHit {
  id: string;
  price: number;
  side: "arriba" | "abajo";
  spot: number;
}

/* Aviso flotante cuando el precio cruza un nivel vigilado */
export function LevelToast({ hit, onDismiss }: { hit: LevelHit | null; onDismiss: () => void }) {
  if (!hit) return null;
  const up = hit.side === "arriba";
  const color = up ? "#2fd6a5" : "#ff4d6d";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div
        className="pointer-events-auto feed-in flex items-center gap-4 rounded-lg border px-5 py-3 shadow-2xl backdrop-blur-md"
        style={{ borderColor: `${color}66`, background: "rgba(9,18,35,0.92)", boxShadow: `0 0 34px -8px ${color}88` }}
      >
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
          <circle cx="13" cy="13" r="10" fill="none" stroke={color} strokeWidth="1.8" />
          <path d={up ? "M13 18V8 M8.5 12.5 13 8l4.5 4.5" : "M13 8v10 M8.5 13.5 13 18l4.5-4.5"} stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <div className="font-mono text-[10px] font-700 tracking-[0.2em]" style={{ color }}>
            NIVEL {up ? "SUPERADO ↑" : "PERDIDO ↓"}
          </div>
          <div className="font-mono text-lg font-700 tabular-nums text-fog">
            {"$" + hit.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            <span className="ml-2 text-[12px] font-500 text-mist">
              spot {"$" + hit.spot.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="ml-2 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-mist transition-colors hover:border-line hover:text-fog"
          aria-label="Cerrar aviso"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
