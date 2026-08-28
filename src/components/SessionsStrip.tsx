import { useEffect, useMemo, useState } from "react";

/* ============================================================
   Sesiones del mercado global (24/7): Asia · Londres · Nueva York
   Reloj mundial, banda de 24h con playhead en vivo, solapes y
   cuenta atrás a la próxima apertura.
   ============================================================ */

interface Session {
  id: "asia" | "london" | "ny";
  name: string;
  city: string;
  tz: string;
  start: number; // hora UTC (decimal)
  end: number;
  color: string;
  hint: string;
}

const SESSIONS: Session[] = [
  {
    id: "asia",
    name: "ASIA",
    city: "Tokio",
    tz: "Asia/Tokyo",
    start: 0,
    end: 8,
    color: "#3fb6ff",
    hint: "Sesión asiática: volumen contenido y rangos — cuidado con las falsas rupturas.",
  },
  {
    id: "london",
    name: "LONDRES",
    city: "Londres",
    tz: "Europe/London",
    start: 7,
    end: 16,
    color: "#ffb547",
    hint: "Londres abre: llega el volumen institucional y se fija el rango del día.",
  },
  {
    id: "ny",
    name: "NUEVA YORK",
    city: "Nueva York",
    tz: "America/New_York",
    start: 13,
    end: 22,
    color: "#e9f1ff",
    hint: "Nueva York: continuación o reversión del día; macro y funding mandan.",
  },
];

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function localTime(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(now);
  } catch {
    return "--:--";
  }
}

export function SessionsStrip() {
  const now = useNow(1000);

  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const playheadPct = (utcH / 24) * 100;

  const active = useMemo(() => SESSIONS.filter((s) => utcH >= s.start && utcH < s.end), [Math.floor(utcH * 60)]);
  const overlap = active.length >= 2;

  const nextOpen = useMemo(() => {
    const starts = SESSIONS.map((s) => s.start).sort((a, b) => a - b);
    const nxt = starts.find((h) => h > utcH);
    const target = nxt ?? starts[0] + 24;
    const diffH = target - utcH;
    return {
      name: SESSIONS.find((s) => s.start === (nxt ?? starts[0]))?.name ?? "",
      label: `${pad2(Math.floor(diffH))}:${pad2(Math.floor((diffH % 1) * 60))}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(utcH * 60)]);

  const hint = overlap
    ? "Solape Londres + Nueva York: pico histórico de volumen y volatilidad — sweeps frecuentes."
    : active.length === 1
      ? active[0].hint
      : "Zona muerta del día: spreads amplios y movimientos poco fiables.";

  return (
    <div className="relative z-10 border-b border-line/70 bg-ink-900/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        {/* marca */}
        <div className="flex items-center gap-2.5">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="#5d7099" strokeWidth="1.4" />
            <path d="M10 2a8 8 0 0 1 0 16" fill="none" stroke="#ffb547" strokeWidth="1.4" />
            <path d="M10 10 L10 4" stroke="#e9f1ff" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M10 10 L14.2 12.4" stroke="#3fb6ff" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <div>
            <div className="text-[12px] font-700 tracking-wide text-fog">SESIONES GLOBALES</div>
            <div className="panel-tag">btc opera 24/7 · la liquidez no</div>
          </div>
        </div>

        {/* banda 24h */}
        <div className="min-w-[260px] flex-1">
          <div className="relative h-4 overflow-hidden rounded-sm border border-line/70 bg-ink-950/80">
            {SESSIONS.map((s) => (
              <div
                key={s.id}
                title={`${s.name} · ${pad2(s.start)}:00–${pad2(s.end)}:00 UTC`}
                className="absolute inset-y-0 transition-opacity duration-300 hover:opacity-90"
                style={{
                  left: `${(s.start / 24) * 100}%`,
                  width: `${((s.end - s.start) / 24) * 100}%`,
                  background: s.color,
                  opacity: active.some((a) => a.id === s.id) ? 0.55 : 0.22,
                  boxShadow: active.some((a) => a.id === s.id) ? `0 0 14px -2px ${s.color}` : "none",
                }}
              />
            ))}
            {/* marcas horarias */}
            {TICKS.map((t) => (
              <div key={t} className="absolute inset-y-0 w-px bg-ink-950/80" style={{ left: `${(t / 24) * 100}%` }} />
            ))}
            {/* playhead */}
            <div
              className="absolute inset-y-[-2px] w-[2px] rounded-full bg-fog"
              style={{ left: `calc(${playheadPct}% - 1px)`, boxShadow: "0 0 10px rgba(233,241,255,0.9)" }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] tabular-nums text-dusk">
            {TICKS.map((t) => (
              <span key={t}>{pad2(t)}</span>
            ))}
            <span>24h UTC</span>
          </div>
        </div>

        {/* estado */}
        <div className="flex items-center gap-2">
          {active.length === 0 ? (
            <span className="rounded-md border border-line px-2.5 py-1 font-mono text-[10px] tracking-widest text-dusk">
              MERCADO EN CALMA
            </span>
          ) : (
            active.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] font-700 tracking-widest"
                style={{ color: s.color, borderColor: `${s.color}66`, background: `${s.color}14` }}
              >
                <span className="live-dot" style={{ background: s.color, color: s.color, width: 6, height: 6 }} />
                {s.name}
              </span>
            ))
          )}
          {overlap && (
            <span className="rounded-md border border-short/60 bg-short/10 px-2.5 py-1 font-mono text-[10px] font-700 tracking-widest text-short-hi">
              SOLAPE · MÁX. VOL
            </span>
          )}
        </div>

        {/* próxima apertura */}
        <div className="font-mono text-[11px] tabular-nums text-mist">
          <span className="panel-tag block">próxima apertura</span>
          <span className="text-fog">{nextOpen.name}</span> <span className="text-long-hi">en {nextOpen.label}</span>
        </div>

        {/* relojes */}
        <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums">
          {SESSIONS.map((s) => (
            <div key={s.id}>
              <span className="panel-tag block">{s.city}</span>
              <span style={{ color: active.some((a) => a.id === s.id) ? s.color : "#93a5c8" }}>
                {localTime(now, s.tz)}
              </span>
            </div>
          ))}
          <div>
            <span className="panel-tag block">UTC</span>
            <span className="text-fog">
              {pad2(now.getUTCHours())}:{pad2(now.getUTCMinutes())}:{pad2(now.getUTCSeconds())}
            </span>
          </div>
        </div>
      </div>

      {/* pista contextual */}
      <div className="border-t border-line/40 bg-ink-950/40">
        <div className="mx-auto max-w-[1500px] px-5 py-1.5 font-mono text-[10.5px] text-dusk">
          <span className="text-mist">▸ contexto de sesión:</span> {hint}
        </div>
      </div>
    </div>
  );
}
