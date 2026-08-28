import { useEffect } from "react";

export interface AbsorptionInfo {
  side: "bid" | "ask"; // bid = ventas absorbidas (alcista) · ask = compras absorbidas (bajista)
  score: number; // 0..1
  note: string;
  at: number;
}

/* Toast de absorción: el flujo agresivo de un lado está siendo absorbido por
   liquidez pasiva del otro — el precio no cede pese a la presión. Señal de que
   puede estar formándose un suelo (bid) o un techo (ask). */
export function AbsorptionToast({ a, onDismiss }: { a: AbsorptionInfo | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!a) return;
    const id = setTimeout(onDismiss, 9000);
    return () => clearTimeout(id);
  }, [a, onDismiss]);

  if (!a) return null;
  // bid → compras pasivas absorben ventas → sesgo ALCISTA (verde/LONG)
  // ask → ventas pasivas absorben compras → sesgo BAJISTA (rojo/SHORT)
  const bullish = a.side === "bid";
  const c = bullish ? "#2fd6a5" : "#ff4d6d";
  const pct = Math.round(a.score * 100);

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
          <path d="M4 22c5-1 7-9 11-11" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
          <path d="M15 11l8-2-2 8" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="24" r="2.4" fill={c} />
          <circle cx="24" cy="22" r="2.4" fill={c} opacity="0.55" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-700 tracking-[0.2em]" style={{ color: c }}>
            ABSORCIÓN DETECTADA
          </div>
          <div className="font-display mt-0.5 text-xl font-900 leading-none" style={{ color: c, textShadow: `0 0 18px ${c}55` }}>
            {bullish ? "PRESIÓN ALCISTA" : "PRESIÓN BAJISTA"}
          </div>
          <div className="mt-1.5 font-mono text-[11px] tabular-nums leading-relaxed text-mist">
            fuerza <b style={{ color: c }}>{pct}%</b> · {bullish ? "ventas absorbidas → posible suelo" : "compras absorbidas → posible techo"}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-dusk">{a.note}</p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[9px] tabular-nums text-dusk">
              {new Date(a.at).toLocaleTimeString("es-ES")}
            </span>
            <button
              onClick={onDismiss}
              className="rounded-md border border-line/70 px-2.5 py-1 font-mono text-[9.5px] font-700 tracking-widest text-mist transition-colors hover:text-fog"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
