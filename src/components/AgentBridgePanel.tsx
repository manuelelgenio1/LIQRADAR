import { useState } from "react";
import type { Verdict } from "../lib/engine";
import { fmtCompact, fmtUsd } from "../lib/engine";
import type { ConfluenceState } from "../hooks/useConfluence";

/* ============================================================
   Puente a Binance Agent OS: convierte el contexto del radar en
   un prompt listo para un agente de IA conectado al servidor MCP
   de Binance (agent.binance.com/mcp/agentic), que puede leer el
   mercado sin autenticación y ejecutar con confirmación en una
   subcuenta Agentic aislada.
   ============================================================ */

const MCP_URL = "https://agent.binance.com/mcp/agentic";

const CLIENTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "comando",
    body: `claude mcp add binance-mcp-server --transport http ${MCP_URL}`,
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    kind: "config JSON",
    body: `{
  "mcpServers": {
    "binance-mcp-server": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`,
  },
  {
    id: "otro",
    label: "Codex / otro cliente",
    kind: "endpoint",
    body: MCP_URL,
  },
];

const SCOPES = [
  { label: "Datos de mercado", note: "público · sin autenticación", tone: "ok" },
  { label: "Cuenta Agentic", note: "saldo y posiciones de la subcuenta", tone: "info" },
  { label: "Trading", note: "spot y futuros · confirma antes de ejecutar", tone: "warn" },
  { label: "Transferencias", note: "solo dentro de la subcuenta", tone: "info" },
  { label: "Retiros", note: "jamás disponibles para el agente", tone: "danger" },
];

function buildRadarContext(v: Verdict, spot: number, longPool: number, shortPool: number, conf: ConfluenceState): string {
  const dir = v.direction === "up" ? "LONG (alcista)" : v.direction === "down" ? "SHORT (bajista)" : "NEUTRO";
  const top = [...v.factors]
    .sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight))
    .slice(0, 3)
    .map((f) => `${f.label}: ${f.detail}`)
    .join("\n  - ");
  return [
    `CONTEXTO LIQRADAR · BTC/USDT · ${new Date().toLocaleString("es-ES")}`,
    `────────────────────────────────────────`,
    `Spot actual:      ${fmtUsd(spot, 1)}`,
    `Rumbo del radar:  ${dir} · sesgo ${v.scorePct > 0 ? "+" : ""}${v.scorePct} · confianza ${v.confidence}%`,
    `Escuelas:         contrarian ${v.contrarianPct > 0 ? "+" : ""}${v.contrarianPct} · impulso ${v.momentumPct > 0 ? "+" : ""}${v.momentumPct} · armonía ${v.harmony}%`,
    `Objetivo (imán):  ${v.target ? `${fmtUsd(v.target.price)} (${v.target.side === "long" ? "liq. de longs" : "liq. de shorts"}, a ${v.target.distancePct.toFixed(2)}%)` : "sin cluster dominante"}`,
    `Invalidación:     ${v.invalidation ? fmtUsd(v.invalidation.price) : "no definida"} (barrerla anula el escenario)`,
    `Ventana estimada: ${v.windowH[0]}–${v.windowH[1]} h`,
    `Régimen:          volatilidad ${v.regime.label} · ATR ${v.regime.atrPct.toFixed(2)}%/h`,
    `Confluencia MTF:  ${conf.gradeLabel} (${conf.biases.filter((b) => b.direction === v.direction).length}/3 horizontes con el rumbo)`,
    `Pools de liq.:    longs ${fmtCompact(longPool)} abajo · shorts ${fmtCompact(shortPool)} arriba`,
    `Factores clave:`,
    `  - ${top}`,
    `────────────────────────────────────────`,
    `Esto es una estimación estadística, no asesoría financiera. Verifica siempre antes de ejecutar.`,
  ].join("\n");
}

function buildPrompts(v: Verdict, spot: number): { id: string; title: string; body: string }[] {
  const side = v.direction === "up" ? "LONG" : "SHORT";
  const verb = v.direction === "up" ? "compra (long)" : "venta (short)";
  const entry = fmtUsd(spot, 0);
  const target = v.target ? fmtUsd(v.target.price, 0) : "[objetivo]";
  const stop = v.invalidation ? fmtUsd(v.invalidation.price, 0) : "[invalidación]";
  return [
    {
      id: "ejecutar",
      title: "Ejecutar la señal con confirmación",
      body:
        `Usando el contexto de mi radar (abajo), abre una posición de ${verb} en BTCUSDT ` +
        `en futuros USDⓈ-M con entrada cerca de ${entry}, take-profit en ${target} y stop en ${stop}. ` +
        `Usa solo mi cuenta Agentic y repite los parámetros para que yo los confirme antes de enviar la orden.\n\n` +
        `[pega aquí el contexto del radar]`,
    },
    {
      id: "vigilar",
      title: "Vigilar niveles clave",
      body:
        `Monitorea BTCUSDT en tiempo real y avísame si el precio toca ${target} (mi objetivo) ` +
        `o ${stop} (mi invalidación). Cuando toque alguno, dime qué lado del contexto del radar queda anulado.`,
    },
    {
      id: "verificar",
      title: "Verificar el contexto con datos en vivo",
      body:
        `Lee el precio, el funding rate, el interés abierto y el ratio long/short de cuentas para BTCUSDT ahora mismo, ` +
        `y compara esos datos con el contexto de mi radar (abajo). Dime si el mercado sigue alineado con mi rumbo ` +
        `${side} o si algo cambió.\n\n[pega aquí el contexto del radar]`,
    },
  ];
}

export function AgentBridgePanel({
  verdict,
  spot,
  longPool,
  shortPool,
  confluence,
}: {
  verdict: Verdict;
  spot: number;
  longPool: number;
  shortPool: number;
  confluence: ConfluenceState;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [client, setClient] = useState(CLIENTS[0].id);

  const ctx = buildRadarContext(verdict, spot, longPool, shortPool, confluence);
  const prompts = buildPrompts(verdict, spot);
  const active = CLIENTS.find((c) => c.id === client) ?? CLIENTS[0];

  const copy = (key: string, text: string) => {
    try {
      void navigator.clipboard.writeText(text);
    } catch {
      /* noop */
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  return (
    <div className="p-5">
      {/* cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">binance agent os · puente de ejecución</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            De la señal del radar a tu agente de IA
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El radar decide; <b className="text-fog">tu agente ejecuta</b>. Copia el contexto actual y pégalo en un agente
            conectado al servidor MCP de Binance — podrá verificar el mercado en vivo y operar en tu{" "}
            <b className="text-fog">subcuenta Agentic aislada</b>, siempre con tu confirmación previa.
          </p>
        </div>
        <a
          href="https://developers.binance.com/en/docs/agent-native/mcp-server/agentic"
          target="_blank"
          rel="noreferrer"
          className="chip"
        >
          docs oficiales ↗
        </a>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
        {/* contexto del radar */}
        <div className="flex flex-col rounded-lg border border-line/70 bg-ink-950/60">
          <div className="flex items-center justify-between border-b border-line/50 px-4 py-2.5">
            <span className="flex items-center gap-2 font-mono text-[10px] font-700 tracking-[0.18em] text-mist">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <rect x="1" y="2.5" width="12" height="9" rx="1.5" stroke="#3fb6ff" strokeWidth="1.3" />
                <path d="M3.5 5.5h7M3.5 8h4.5" stroke="#3fb6ff" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              CONTEXTO DEL RADAR · TIEMPO REAL
            </span>
            <button
              onClick={() => copy("ctx", ctx)}
              className={`chip ${copied === "ctx" ? "on" : ""}`}
            >
              {copied === "ctx" ? "✓ COPIADO" : "⧉ COPIAR CONTEXTO"}
            </button>
          </div>
          <pre className="slim-scroll flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[10.5px] leading-relaxed text-mist">
            {ctx}
          </pre>
        </div>

        {/* conexión MCP */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
            <div className="panel-tag">1 · conecta tu agente (una sola vez)</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CLIENTS.map((c) => (
                <button key={c.id} className={`chip ${client === c.id ? "on" : ""}`} onClick={() => setClient(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex items-start gap-2 rounded-md border border-line/60 bg-ink-900/70 px-3 py-2.5">
              <pre className="slim-scroll flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-fog">
                {active.body}
              </pre>
              <button onClick={() => copy("mcp", active.body)} className={`chip shrink-0 ${copied === "mcp" ? "on" : ""}`}>
                {copied === "mcp" ? "✓" : "⧉"}
              </button>
            </div>
            <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-dusk">
              <span className="text-pulse">{active.kind}</span> · al conectar, Binance te pide autenticarte y elegir
              permisos. Empieza solo con «datos de mercado» (no requiere autorización).
            </p>
          </div>

          {/* scopes */}
          <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
            <div className="panel-tag">2 · qué puede hacer tu agente</div>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SCOPES.map((s) => {
                const c =
                  s.tone === "ok" ? "#2fd6a5" : s.tone === "warn" ? "#ffb547" : s.tone === "danger" ? "#ff4d6d" : "#3fb6ff";
                return (
                  <li key={s.label} className="flex items-start gap-2 rounded-md border border-line/40 bg-ink-900/40 px-2.5 py-1.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
                    <span className="text-[11px] leading-snug">
                      <b className="text-fog">{s.label}</b> <span className="text-dusk">· {s.note}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* prompts sugeridos */}
      <div className="mt-4">
        <div className="panel-tag">3 · prompts listos para tu agente (se rellenan con la señal actual)</div>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          {prompts.map((p) => (
            <div
              key={p.id}
              className="group flex flex-col rounded-lg border border-line/60 bg-ink-950/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line"
            >
              <span className="text-[12px] font-700 text-fog">{p.title}</span>
              <p className="mt-1.5 flex-1 text-[11px] leading-relaxed text-dusk">{p.body.slice(0, 130)}…</p>
              <button onClick={() => copy(p.id, p.body)} className={`chip mt-2.5 self-start ${copied === p.id ? "on" : ""}`}>
                {copied === p.id ? "✓ COPIADO" : "⧉ COPIAR PROMPT"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 border-t border-line/40 pt-3 font-mono text-[9.5px] leading-relaxed text-dusk">
        El agente opera con <b className="text-warn">dinero real</b> dentro de tu subcuenta Agentic y puede equivocarse:
        confirma cada orden, fondea solo lo que estés dispuesto a arriesgar y recuerda que el radar entrega probabilidades,
        no certezas. El radar no da órdenes al agente directamente — tú llevas el contexto y decides.
      </p>
    </div>
  );
}
