import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIT_LEVEL_META,
  AUDIT_SOURCE_META,
  buildAuditReport,
  clearAudit,
  eventsToCsv,
  logAudit,
  reportToText,
  type AuditEvent,
  type AuditLevel,
  type AuditSource,
} from "../lib/auditLog";
import { useAuditLog } from "../hooks/useAuditLog";

/* ============================================================
   Registro de auditoría: todo lo que hace el sistema, en vivo.
   Los errores salen a la luz aquí en vez de perderse en silencio.
   ============================================================ */

const LEVELS: (AuditLevel | "all")[] = ["all", "error", "warn", "ok", "info"];
const SOURCES: (AuditSource | "all")[] = ["all", "motor", "datos", "confluencia", "agente", "sistema", "ui"];

export function AuditLogPanel() {
  const events = useAuditLog();
  const [level, setLevel] = useState<AuditLevel | "all">("all");
  const [source, setSource] = useState<AuditSource | "all">("all");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [report, setReport] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => (level === "all" || e.level === level) && (source === "all" || e.source === source))
      .filter((e) => !q || e.msg.toLowerCase().includes(q) || (e.detail ?? "").toLowerCase().includes(q))
      .slice(-140)
      .reverse();
  }, [events, level, source, query]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, ok: 0, info: 0 };
    events.forEach((e) => c[e.level]++);
    return c;
  }, [events]);

  useEffect(() => {
    if (autoScroll && feedRef.current) feedRef.current.scrollTop = 0; // lo más nuevo arriba
  }, [events, autoScroll]);

  const health = counts.error > 0 ? "con errores" : counts.warn > 0 ? "con avisos" : "sano";
  const healthColor = counts.error > 0 ? "#ff4d6d" : counts.warn > 0 ? "#ffb547" : "#2fd6a5";

  const generateReport = () => {
    const txt = reportToText(buildAuditReport());
    setReport(txt);
    logAudit("ui", "info", `Informe de auditoría generado (${events.length} eventos)`);
  };

  const download = (content: string, name: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-5">
      {/* cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">13 · registro de auditoría</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Bitácora del sistema · nada falla en silencio
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            Cada decisión del motor, cada fallo de datos, cada acción del agente y cada error de runtime queda
            registrado aquí. Genera informes, exporta el historial y usa los <b className="text-fog">errores</b> como
            lista de corrección.
          </p>
        </div>
        <span
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-[11px] font-700 tracking-widest"
          style={{ color: healthColor, borderColor: `${healthColor}55`, background: `${healthColor}10` }}
        >
          <span className="live-dot" style={{ background: healthColor, color: healthColor }} />
          {health.toUpperCase()}
        </span>
      </div>

      {/* contadores */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            { k: "total", label: "eventos", v: events.length, color: "#e9f1ff" },
            { k: "error", label: "errores", v: counts.error, color: "#ff4d6d" },
            { k: "warn", label: "avisos", v: counts.warn, color: "#ffb547" },
            { k: "ok", label: "confirmaciones", v: counts.ok, color: "#2fd6a5" },
            { k: "info", label: "info", v: counts.info, color: "#3fb6ff" },
          ] as const
        ).map((s) => (
          <div key={s.k} className="rounded-lg border border-line/60 bg-ink-950/40 px-3 py-2.5">
            <div className="font-mono text-xl font-700 tabular-nums" style={{ color: s.color }}>
              {s.v}
            </div>
            <div className="panel-tag mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* filtros */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => (
          <button key={l} className={`chip ${level === l ? "on" : ""}`} onClick={() => setLevel(l)}>
            {l === "all" ? "TODOS" : AUDIT_LEVEL_META[l].label}
          </button>
        ))}
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as AuditSource | "all")}
          className="rounded-md border border-line bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] text-fog outline-none focus:border-pulse/60"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "origen: todos" : AUDIT_SOURCE_META[s].label}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="buscar en el registro…"
          className="w-48 rounded-md border border-line bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] text-fog outline-none transition-colors placeholder:text-dusk focus:border-pulse/60"
        />
        <button className={`chip ${autoScroll ? "on" : ""}`} onClick={() => setAutoScroll(!autoScroll)}>
          {autoScroll ? "autoscroll ✓" : "autoscroll"}
        </button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button className="chip" onClick={generateReport}>
            ▤ informe
          </button>
          <button className="chip" onClick={() => download(eventsToCsv(events), `liqradar-auditoria-${Date.now()}.csv`, "text/csv;charset=utf-8")}>
            ⬇ csv
          </button>
          <button className="chip" onClick={() => download(JSON.stringify(events, null, 2), `liqradar-auditoria-${Date.now()}.json`, "application/json")}>
            ⬇ json
          </button>
          <button
            className="chip"
            onClick={() => {
              clearAudit();
              setReport(null);
            }}
          >
            ✕ limpiar
          </button>
        </div>
      </div>

      {/* informe */}
      {report && (
        <div className="feed-in mt-3 rounded-lg border border-pulse/40 bg-ink-950/60 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-700 tracking-[0.2em] text-pulse">INFORME GENERADO</span>
            <div className="flex gap-1.5">
              <button
                className="chip"
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(report);
                    logAudit("ui", "ok", "Informe copiado al portapapeles");
                  } catch {
                    /* noop */
                  }
                }}
              >
                ⧉ copiar
              </button>
              <button className="chip" onClick={() => download(report, `informe-liqradar-${Date.now()}.txt`, "text/plain;charset=utf-8")}>
                ⬇ txt
              </button>
              <button className="chip" onClick={() => setReport(null)}>
                ✕
              </button>
            </div>
          </div>
          <pre className="slim-scroll mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-mist">{report}</pre>
        </div>
      )}

      {/* feed en vivo */}
      <div
        ref={feedRef}
        className="slim-scroll mt-3 flex max-h-[380px] min-h-[220px] flex-col gap-1 overflow-y-auto rounded-lg border border-line/60 bg-ink-950/50 p-2.5"
      >
        {filtered.length === 0 && (
          <div className="flex flex-1 items-center justify-center font-mono text-[11px] text-dusk">
            sin eventos para este filtro — el sistema sigue registrando…
          </div>
        )}
        {filtered.map((e) => (
          <AuditRow key={e.id} e={e} />
        ))}
      </div>

      <p className="mt-3 border-t border-line/40 pt-2.5 font-mono text-[10px] leading-relaxed text-dusk">
        El registro captura errores de runtime globales, rechazos de promesas, caídas de fuentes de datos, cambios de
        rumbo, acciones del agente y eventos de la interfaz. Persiste en tu navegador (últimos 250 eventos).
      </p>
    </div>
  );
}

function AuditRow({ e }: { e: AuditEvent }) {
  const lm = AUDIT_LEVEL_META[e.level];
  const sm = AUDIT_SOURCE_META[e.source];
  return (
    <div
      className={`feed-in group flex items-start gap-2.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
        e.level === "error" ? "border-short/40 bg-short/[0.06]" : "border-line/40 bg-ink-900/30 hover:border-line/70"
      }`}
    >
      <span className="mt-0.5 w-[52px] shrink-0 tabular-nums text-dusk">
        {new Date(e.t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span
        className="mt-0.5 w-[52px] shrink-0 rounded-sm px-1 py-0.5 text-center text-[8.5px] font-700 tracking-wider"
        style={{ color: lm.color, background: `${lm.color}14`, border: `1px solid ${lm.color}44` }}
      >
        {lm.label}
      </span>
      <span className="mt-0.5 w-[68px] shrink-0 text-[9.5px] font-700 tracking-wider" style={{ color: sm.color }}>
        {sm.label}
      </span>
      <span className={`min-w-0 flex-1 leading-snug ${e.level === "error" ? "text-short-hi" : "text-mist"}`}>
        {e.msg}
        {e.detail && <span className="ml-2 text-[10px] text-dusk">· {e.detail}</span>}
      </span>
    </div>
  );
}
