import { useState } from "react";

export interface SniperCfg {
  on: boolean;
  biasTh: number;
  confTh: number;
}

export interface PriceLevel {
  id: string;
  price: number;
  side: "arriba" | "abajo";
  fired: boolean;
  createdAt: number;
}

interface Props {
  sniper: SniperCfg;
  onSniper: (s: SniperCfg) => void;
  webhook: string;
  onWebhook: (url: string) => void;
  onTest: () => void;
  lastFire: number | null;
  spot: number;
  levels: PriceLevel[];
  onAddLevel: (price: number) => void;
  onRemoveLevel: (id: string) => void;
}

/* Centro de alertas: francotirador (umbrales) + niveles de precio + webhook */
export function AlertCenter({ sniper, onSniper, webhook, onWebhook, onTest, lastFire, spot, levels, onAddLevel, onRemoveLevel }: Props) {
  const [lvlInput, setLvlInput] = useState("");
  const addLevel = () => {
    const p = Number(lvlInput);
    if (!Number.isFinite(p) || p <= 0) return;
    onAddLevel(p);
    setLvlInput("");
  };
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

      {/* niveles de precio vigilados */}
      <div className="mt-3 border-t border-line/40 pt-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="panel-tag">vigilar nivel</span>
          <input
            type="number"
            value={lvlInput}
            onChange={(e) => setLvlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLevel()}
            placeholder={`p. ej. ${Math.round(spot).toLocaleString("en-US")}`}
            className="w-36 rounded-md border border-line bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-fog outline-none transition-colors placeholder:text-dusk focus:border-pulse/60"
          />
          <button className="chip on" onClick={addLevel}>
            ＋ añadir
          </button>
          <span className="font-mono text-[10px] text-dusk">
            spot actual <b className="text-fog">${Math.round(spot).toLocaleString("en-US")}</b>
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {levels.length === 0 && <span className="font-mono text-[10px] text-dusk">sin niveles vigilados</span>}
            {levels.map((l) => {
              const up = l.side === "arriba";
              const color = l.fired ? "#5d7099" : up ? "#2fd6a5" : "#ff4d6d";
              return (
                <button
                  key={l.id}
                  onClick={() => onRemoveLevel(l.id)}
                  title={l.fired ? "Nivel ya alcanzado — clic para quitar" : up ? "Aviso si el precio SUBE a este nivel — clic para quitar" : "Aviso si el precio BAJA a este nivel — clic para quitar"}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10.5px] tabular-nums transition-all hover:-translate-y-0.5"
                  style={{ borderColor: `${color}55`, background: `${color}10`, color, opacity: l.fired ? 0.5 : 1 }}
                >
                  <span>{up ? "↑" : "↓"}</span>
                  <span>${Math.round(l.price).toLocaleString("en-US")}</span>
                  <span className="text-[9px] opacity-70">{l.fired ? "✓" : "✕"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-2 border-t border-line/40 pt-2 font-mono text-[10px] leading-relaxed text-dusk">
        El radar dispara alerta visual + sonora + webhook cuando el sesgo/confianza superan los umbrales del francotirador
        (45s entre señales) <b className="text-mist">o cuando el precio cruza un nivel vigilado</b>. Todo queda guardado en tu navegador.
      </p>
    </div>
  );
}
