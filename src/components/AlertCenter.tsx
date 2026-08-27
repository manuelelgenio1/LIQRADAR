export interface SniperCfg {
  on: boolean;
  biasTh: number;
  confTh: number;
}

interface Props {
  sniper: SniperCfg;
  onSniper: (s: SniperCfg) => void;
  webhook: string;
  onWebhook: (url: string) => void;
  onTest: () => void;
  lastFire: number | null;
}

/* Centro de alertas: modo francotirador (umbrales) + webhook externo */
export function AlertCenter({ sniper, onSniper, webhook, onWebhook, onTest, lastFire }: Props) {
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
        {/* marca */}
        <div className="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
            <circle cx="11" cy="11" r="7.5" fill="none" stroke={sniper.on ? "#ffb547" : "#5d7099"} strokeWidth="1.5" />
            <path d="M11 1v4M11 17v4M1 11h4M17 11h4" stroke={sniper.on ? "#ffb547" : "#5d7099"} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div>
            <div className="text-[12.5px] font-700 text-fog">Centro de alertas</div>
            <div className="panel-tag">francotirador + webhook</div>
          </div>
        </div>

        {/* interruptor sniper */}
        <button
          onClick={() => onSniper({ ...sniper, on: !sniper.on })}
          className={`chip ${sniper.on ? "on" : ""}`}
          style={sniper.on ? { borderColor: "rgba(255,181,71,0.7)", color: "#ffb547", background: "rgba(255,181,71,0.09)" } : undefined}
          aria-pressed={sniper.on}
        >
          {sniper.on ? "◉ FRANCOTIRADOR ON" : "○ francotirador off"}
        </button>

        {/* umbrales */}
        <label className="flex items-center gap-2.5 font-mono text-[11px] text-mist">
          <span className="panel-tag">sesgo ≥</span>
          <input
            type="range"
            min={20}
            max={90}
            step={5}
            value={sniper.biasTh}
            disabled={!sniper.on}
            onChange={(e) => onSniper({ ...sniper, biasTh: Number(e.target.value) })}
            className="w-24 accent-[#ffb547] disabled:opacity-40"
          />
          <span className="w-7 tabular-nums text-fog">{sniper.biasTh}</span>
        </label>
        <label className="flex items-center gap-2.5 font-mono text-[11px] text-mist">
          <span className="panel-tag">confianza ≥</span>
          <input
            type="range"
            min={30}
            max={85}
            step={5}
            value={sniper.confTh}
            disabled={!sniper.on}
            onChange={(e) => onSniper({ ...sniper, confTh: Number(e.target.value) })}
            className="w-24 accent-[#ffb547] disabled:opacity-40"
          />
          <span className="w-8 tabular-nums text-fog">{sniper.confTh}%</span>
        </label>

        {/* webhook */}
        <label className="flex min-w-[240px] flex-1 items-center gap-2 font-mono text-[11px]">
          <span className="panel-tag shrink-0">webhook</span>
          <input
            type="url"
            value={webhook}
            onChange={(e) => onWebhook(e.target.value)}
            placeholder="https://discord…/webhooks/… o Telegram bot URL"
            className="w-full min-w-0 rounded-md border border-line bg-ink-950/70 px-2.5 py-1.5 text-[11px] text-fog outline-none transition-colors placeholder:text-dusk focus:border-warn/60"
          />
        </label>

        <button className="chip" onClick={onTest}>
          ⚡ probar
        </button>

        <span className="ml-auto font-mono text-[10px] tabular-nums text-dusk">
          {lastFire ? `última señal ${new Date(lastFire).toLocaleTimeString("es-ES")}` : "sin señales aún en esta sesión"}
        </span>
      </div>
      <p className="mt-2 border-t border-line/40 pt-2 font-mono text-[10px] leading-relaxed text-dusk">
        Cuando el sesgo y la confianza superan ambos umbrales (con 45s de espera entre señales), el radar dispara alerta
        visual + sonora y, si hay webhook configurado, envía el evento en JSON. Todo queda guardado en tu navegador.
      </p>
    </div>
  );
}
