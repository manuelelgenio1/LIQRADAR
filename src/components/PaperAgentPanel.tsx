import type { AgentPosition, AgentRules, AgentState } from "../lib/paperAgent";
import { agentStats, markToMarket } from "../lib/paperAgent";

/* ============================================================
   Agente LiqRadar — interfaz del agente autónomo de paper trading.
   ============================================================ */

type Status = "off" | "vigilando" | "posicion";

interface Props {
  rules: AgentRules;
  onRules: (r: AgentRules) => void;
  state: AgentState;
  spot: number;
  onClosePosition: () => void;
  onReset: () => void;
}

const LOG_COLOR: Record<string, string> = {
  info: "#93a5c8",
  open: "#5ef2c4",
  close: "#ffce87",
  warn: "#ffb547",
  signal: "#3fb6ff",
};

function PositionCard({ p, spot, onClose }: { p: AgentPosition; spot: number; onClose: () => void }) {
  const mtm = markToMarket(p, spot);
  const win = mtm.pnlUsd >= 0;
  const c = p.side === "long" ? "#2fd6a5" : "#ff4d6d";
  // progreso del precio entre stop y objetivo
  const lo = Math.min(p.stop, p.target);
  const hi = Math.max(p.stop, p.target);
  const prog = Math.min(100, Math.max(0, ((spot - lo) / (hi - lo || 1)) * 100));

  return (
    <div
      className="feed-in relative overflow-hidden rounded-lg border p-4"
      style={{ borderColor: `${c}55`, background: `linear-gradient(160deg, ${c}0d, rgba(7,16,31,0.6))` }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${c}, transparent)` }} />
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="rounded-md px-2.5 py-1 font-display text-[15px] font-900 tracking-tight"
          style={{ color: c, background: `${c}14`, border: `1px solid ${c}55` }}
        >
          {p.side === "long" ? "▲ LONG" : "▼ SHORT"}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-mist">
          entrada <b className="text-fog">${Math.round(p.entry).toLocaleString("en-US")}</b>
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-mist">
          tamaño <b className="text-fog">{p.qtyBtc.toFixed(5)} BTC</b>
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded-md border border-line px-3 py-1.5 font-mono text-[10px] tracking-widest text-mist transition-all hover:-translate-y-0.5 hover:border-short/60 hover:text-short-hi"
        >
          CERRAR MANUAL
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <div className="panel-tag">pnl en vivo</div>
          <div
            className="font-mono text-2xl font-700 tabular-nums"
            style={{ color: win ? "#5ef2c4" : "#ff7d95", textShadow: `0 0 20px ${win ? "rgba(94,242,196,0.35)" : "rgba(255,125,149,0.35)"}` }}
          >
            {win ? "+" : "−"}${Math.abs(mtm.pnlUsd).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="panel-tag">en precio</div>
          <div className={`font-mono text-lg font-700 tabular-nums ${win ? "text-long-hi" : "text-short-hi"}`}>
            {mtm.pnlPct >= 0 ? "+" : ""}{mtm.pnlPct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="panel-tag">en R</div>
          <div className={`font-mono text-lg font-700 tabular-nums ${win ? "text-long-hi" : "text-short-hi"}`}>
            {mtm.pnlR >= 0 ? "+" : ""}{mtm.pnlR.toFixed(2)}R
          </div>
        </div>
        <div>
          <div className="panel-tag">spot</div>
          <div className="font-mono text-lg font-700 tabular-nums text-warn">${Math.round(spot).toLocaleString("en-US")}</div>
        </div>
      </div>

      {/* recorrido stop → objetivo */}
      <div className="mt-3">
        <div className="relative h-2.5 rounded-full bg-ink-950/80">
          <div
            className="absolute top-0 h-full rounded-full transition-all duration-500"
            style={{ width: `${prog}%`, background: `linear-gradient(90deg, ${c}55, ${c})`, boxShadow: `0 0 12px ${c}66` }}
          />
          <div className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-warn shadow-[0_0_8px_rgba(255,181,71,0.9)] transition-all duration-500" style={{ left: `calc(${prog}% - 1px)` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9.5px] tabular-nums">
          <span className="text-short-hi">STOP ${Math.round(p.stop).toLocaleString("en-US")}</span>
          <span className="text-dusk">recorrido al objetivo</span>
          <span className="text-long-hi">OBJETIVO ${Math.round(p.target).toLocaleString("en-US")}</span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-line/40 pt-2.5 font-mono text-[9.5px] tabular-nums text-dusk">
        <span>sesgo entrada <b className="text-mist">{p.bias > 0 ? "+" : ""}{p.bias}</b></span>
        <span>confianza <b className="text-mist">{p.confidence}%</b></span>
        <span>confluencia <b className="text-mist">{p.confluence}/3</b></span>
        <span>razón <b className="text-mist">{p.reason}</b></span>
      </div>
    </div>
  );
}

export function PaperAgentPanel({ rules, onRules, state, spot, onClosePosition, onReset }: Props) {
  const status: Status = !rules.on ? "off" : state.position ? "posicion" : "vigilando";
  const coreColor = status === "off" ? "#5d7099" : status === "vigilando" ? "#3fb6ff" : state.position?.side === "long" ? "#2fd6a5" : "#ff4d6d";
  const coreWord = status === "off" ? "DORMIDO" : status === "vigilando" ? "VIGILANDO" : state.position?.side === "long" ? "EN LONG" : "EN SHORT";
  const stats = agentStats(state);
  const equityPnl = state.equity - rules.capital;

  return (
    <div className="p-5">
      {/* cabecera: núcleo del agente */}
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full"
            style={{ border: `2px solid ${coreColor}44`, animation: status === "off" ? "none" : `verdictPulse ${status === "posicion" ? "1.1s" : "2s"} ease-out infinite`, color: coreColor }}
          />
          <span className="absolute inset-2 rounded-full" style={{ background: `${coreColor}12`, border: `1px solid ${coreColor}66` }} />
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden className="relative">
            <circle cx="13" cy="13" r="8" stroke={coreColor} strokeWidth="1.6" />
            <circle cx="13" cy="13" r="2.4" fill={coreColor} />
            <path d="M13 1.5v4M13 20.5v4M1.5 13h4M20.5 13h4" stroke={coreColor} strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-dusk">
            <span className="live-dot" style={{ background: coreColor, color: coreColor, animationPlayState: status === "off" ? "paused" : "running", opacity: status === "off" ? 0.4 : 1 }} />
            AGENTE LIQRADAR · PAPER TRADING AUTÓNOMO
          </div>
          <div className="font-display mt-0.5 text-2xl font-900 tracking-tight" style={{ color: coreColor, textShadow: status === "off" ? "none" : `0 0 24px ${coreColor}55` }}>
            {coreWord}
          </div>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mist">
            Un agente que <b className="text-fog">monitorea el radar, reacciona a las señales y actúa cuando se cumplen tus condiciones</b> —
            la misma promesa de Binance Agent OS, ejecutada aquí con dinero virtual y datos reales. {rules.on ? "Está activo ahora." : "Enciéndelo para activarlo."}
          </p>
        </div>

        {/* interruptor + autonomía */}
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={() => onRules({ ...rules, on: !rules.on })}
            className="relative h-9 w-[76px] rounded-full border transition-all duration-300"
            style={{
              borderColor: rules.on ? `${coreColor}88` : "#1b2c4a",
              background: rules.on ? `${coreColor}18` : "rgba(10,21,38,0.7)",
              boxShadow: rules.on ? `0 0 22px -4px ${coreColor}66` : "none",
            }}
            aria-pressed={rules.on}
            title={rules.on ? "Apagar el agente" : "Encender el agente"}
          >
            <span
              className="absolute top-1 h-[26px] w-[26px] rounded-full transition-all duration-300"
              style={{ left: rules.on ? "46px" : "4px", background: rules.on ? coreColor : "#5d7099", boxShadow: rules.on ? `0 0 14px ${coreColor}` : "none" }}
            />
          </button>
          <div className="flex gap-1.5">
            <button
              className={`chip ${rules.autonomy === "alerts" ? "on" : ""}`}
              onClick={() => onRules({ ...rules, autonomy: "alerts" })}
              title="El agente avisa cuando la señal califica, pero no abre posiciones"
            >
              SOLO ALERTAS
            </button>
            <button
              className={`chip ${rules.autonomy === "auto" ? "on" : ""}`}
              onClick={() => onRules({ ...rules, autonomy: "auto" })}
              title="El agente abre y cierra posiciones paper automáticamente"
            >
              AUTO PAPER
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.25fr]">
        {/* columna izquierda: reglas + stats */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
            <div className="flex items-center justify-between">
              <span className="panel-tag">reglas de activación</span>
              <span className="font-mono text-[9.5px] text-dusk">la señal debe cumplir TODAS</span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {(
                [
                  { k: "minBias", label: "sesgo mínimo", min: 10, max: 80, step: 5, fmt: (v: number) => `${v}` },
                  { k: "minConf", label: "confianza mínima", min: 30, max: 85, step: 5, fmt: (v: number) => `${v}%` },
                  { k: "minConfluence", label: "confluencia mínima", min: 0, max: 3, step: 1, fmt: (v: number) => `${v}/3` },
                  { k: "riskPct", label: "riesgo por operación", min: 0.25, max: 3, step: 0.25, fmt: (v: number) => `${v}%` },
                  { k: "cooldownSec", label: "cooldown entre ops", min: 60, max: 1800, step: 60, fmt: (v: number) => `${Math.round(v / 60)} min` },
                ] as const
              ).map((s) => (
                <label key={s.k} className="grid grid-cols-[130px_1fr_64px] items-center gap-3 font-mono text-[11px] text-mist">
                  <span className="text-[10.5px]">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={rules[s.k]}
                    disabled={!rules.on}
                    onChange={(e) => onRules({ ...rules, [s.k]: Number(e.target.value) })}
                    className="w-full accent-[#3fb6ff] disabled:opacity-40"
                  />
                  <span className="text-right tabular-nums text-fog">{s.fmt(rules[s.k])}</span>
                </label>
              ))}
              <label className="grid grid-cols-[130px_1fr_64px] items-center gap-3 font-mono text-[11px] text-mist">
                <span className="text-[10.5px]">capital paper</span>
                <input
                  type="number"
                  min={10}
                  value={rules.capital}
                  disabled={!rules.on}
                  onChange={(e) => onRules({ ...rules, capital: Math.max(10, Number(e.target.value) || 10) })}
                  className="w-full rounded-md border border-line bg-ink-950/70 px-2 py-1 text-right tabular-nums text-fog outline-none focus:border-pulse/60 disabled:opacity-40"
                />
                <span className="text-right text-dusk">USDT</span>
              </label>
            </div>
          </div>

          {/* stats */}
          <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
            <div className="flex items-center justify-between">
              <span className="panel-tag">rendimiento del agente</span>
              <button onClick={onReset} className="chip" title="Borrar historial y reiniciar el equity">REINICIAR</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <div className="rounded-md border border-line/50 bg-ink-900/40 px-3 py-2.5">
                <div className="panel-tag">equity paper</div>
                <div className="mt-0.5 font-mono text-lg font-700 tabular-nums text-fog">${state.equity.toFixed(0)}</div>
                <div className={`font-mono text-[10px] tabular-nums ${equityPnl >= 0 ? "text-long-hi" : "text-short-hi"}`}>
                  {equityPnl >= 0 ? "+" : ""}{equityPnl.toFixed(0)} USDT
                </div>
              </div>
              <div className="rounded-md border border-line/50 bg-ink-900/40 px-3 py-2.5">
                <div className="panel-tag">win rate</div>
                <div className={`mt-0.5 font-mono text-lg font-700 tabular-nums ${stats.winRate === null ? "text-dusk" : stats.winRate >= 50 ? "text-long-hi" : "text-short-hi"}`}>
                  {stats.winRate === null ? "—" : `${Math.round(stats.winRate)}%`}
                </div>
                <div className="font-mono text-[10px] tabular-nums text-dusk">{stats.wins}✓ / {stats.losses}✕</div>
              </div>
              <div className="rounded-md border border-line/50 bg-ink-900/40 px-3 py-2.5">
                <div className="panel-tag">R acumulado</div>
                <div className={`mt-0.5 font-mono text-lg font-700 tabular-nums ${stats.totalR >= 0 ? "text-long-hi" : "text-short-hi"}`}>
                  {stats.totalR >= 0 ? "+" : ""}{stats.totalR.toFixed(1)}R
                </div>
                <div className="font-mono text-[10px] tabular-nums text-dusk">media {stats.avgR >= 0 ? "+" : ""}{stats.avgR.toFixed(2)}R</div>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9.5px] tabular-nums text-dusk">
              <span>{stats.closed} operaciones</span>
              <span className="text-long-hi">{stats.byObjective} por objetivo</span>
              <span className="text-short-hi">{stats.byStop} por stop</span>
              <span className="text-warn">{stats.byFlip} por giro</span>
              <span>mejor {stats.best >= 0 ? "+" : ""}{stats.best.toFixed(1)}R · peor {stats.worst.toFixed(1)}R</span>
            </div>
          </div>
        </div>

        {/* columna derecha: posición + log */}
        <div className="flex min-h-[300px] flex-col gap-4">
          {state.position ? (
            <PositionCard p={state.position} spot={spot} onClose={onClosePosition} />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-line/60 bg-ink-950/30 px-4 py-6 text-center font-mono text-[11px] text-dusk">
              {rules.on
                ? "SIN POSICIÓN ABIERTA — el agente espera una señal que cumpla las reglas"
                : "AGENTE APAGADO — enciéndelo para que vigile el radar"}
            </div>
          )}

          {/* log de actividad */}
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-line/70 bg-[#04091270] p-3.5">
            <div className="flex items-center justify-between">
              <span className="panel-tag">registro de actividad</span>
              <span className="font-mono text-[9.5px] tabular-nums text-dusk">{state.log.length} eventos</span>
            </div>
            <div className="slim-scroll mt-2 flex-1 space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 240, minHeight: 120 }}>
              {state.log.length === 0 && (
                <div className="flex h-24 items-center justify-center font-mono text-[10.5px] text-dusk">
                  — sin actividad todavía —
                </div>
              )}
              {state.log.map((e) => (
                <div key={e.id} className="feed-in flex gap-2.5 font-mono text-[10.5px] leading-relaxed">
                  <span className="shrink-0 tabular-nums text-dusk">
                    {new Date(e.t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span style={{ color: LOG_COLOR[e.kind] }}>▸</span>
                  <span className="text-mist">{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 border-t border-line/40 pt-3 font-mono text-[10px] leading-relaxed text-dusk">
        El agente opera con <b className="text-mist">dinero virtual</b> sobre datos reales de Binance — nunca toca una cuenta real.
        Para ejecución real conecta tu agente de IA vía el puente Binance Agent OS (arriba) o configura un webhook. Todo persiste en tu navegador.
      </p>
    </div>
  );
}
