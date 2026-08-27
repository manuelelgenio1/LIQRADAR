/* ============================================================
   Registro de auditoría de LiqRadar.
   Captura TODO lo relevante que hace el sistema — decisiones del
   motor, fallos de datos, acciones del agente y errores de runtime
   — para que nada se pierda en silencio y los errores salgan a la
   luz en vez de dejarlos pasar.
   ============================================================ */

export type AuditLevel = "ok" | "info" | "warn" | "error";
export type AuditSource = "motor" | "datos" | "confluencia" | "agente" | "sistema" | "ui";

export interface AuditEvent {
  id: number;
  t: number; // ms epoch
  level: AuditLevel;
  source: AuditSource;
  msg: string;
  detail?: string;
}

export const AUDIT_LEVEL_META: Record<AuditLevel, { label: string; color: string }> = {
  error: { label: "ERROR", color: "#ff4d6d" },
  warn: { label: "AVISO", color: "#ffb547" },
  ok: { label: "OK", color: "#2fd6a5" },
  info: { label: "INFO", color: "#3fb6ff" },
};

export const AUDIT_SOURCE_META: Record<AuditSource, { label: string; color: string }> = {
  motor: { label: "MOTOR", color: "#e05cd0" },
  datos: { label: "DATOS", color: "#3fb6ff" },
  confluencia: { label: "MTF", color: "#2fd6d6" },
  agente: { label: "AGENTE", color: "#ffb547" },
  sistema: { label: "SISTEMA", color: "#93a5c8" },
  ui: { label: "UI", color: "#e9f1ff" },
};

const KEY = "liqradar-audit-v1";
const MEM_CAP = 600; // en memoria
const DISK_CAP = 250; // persistidos

let buffer: AuditEvent[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let version = 0;

function load(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as AuditEvent[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e.t === "number" && typeof e.msg === "string");
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(buffer.slice(-DISK_CAP)));
  } catch {
    /* almacenamiento lleno o bloqueado: el registro sigue en memoria */
  }
}

function emit() {
  version++;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* un suscriptor roto no debe tumbar el registro */
    }
  });
}

buffer = load();
nextId = buffer.reduce((m, e) => Math.max(m, e.id), 0) + 1;

/** Registra un evento de auditoría (lo último llega al final). */
export function logAudit(source: AuditSource, level: AuditLevel, msg: string, detail?: string) {
  buffer.push({ id: nextId++, t: Date.now(), level, source, msg, detail });
  if (buffer.length > MEM_CAP) buffer = buffer.slice(-MEM_CAP);
  persist();
  emit();
}

export function getAuditEvents(): AuditEvent[] {
  return buffer;
}

export function getAuditVersion(): number {
  return version;
}

export function subscribeAudit(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearAudit() {
  buffer = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  logAudit("sistema", "info", "Registro de auditoría limpiado por el usuario");
}

/* ---------- errores globales: nada falla en silencio ---------- */
let installed = false;
export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    logAudit("sistema", "error", `Error de runtime: ${e.message || "desconocido"}`, e.filename ? `${e.filename}:${e.lineno}` : undefined);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    logAudit("sistema", "error", `Promesa rechazada sin manejar: ${msg}`);
  });
  logAudit("sistema", "ok", "LiqRadar iniciado · capturadores de errores activos");
}

/* ---------- informes ---------- */
export interface AuditReport {
  generatedAt: number;
  total: number;
  byLevel: Record<AuditLevel, number>;
  bySource: Record<AuditSource, number>;
  lastErrors: AuditEvent[];
  lastWarns: AuditEvent[];
  spanMin: number; // minutos cubiertos por el registro
  health: "sano" | "con avisos" | "con errores";
}

export function buildAuditReport(): AuditReport {
  const byLevel: Record<AuditLevel, number> = { ok: 0, info: 0, warn: 0, error: 0 };
  const bySource: Record<AuditSource, number> = { motor: 0, datos: 0, confluencia: 0, agente: 0, sistema: 0, ui: 0 };
  for (const e of buffer) {
    byLevel[e.level]++;
    bySource[e.source]++;
  }
  const lastErrors = buffer.filter((e) => e.level === "error").slice(-8).reverse();
  const lastWarns = buffer.filter((e) => e.level === "warn").slice(-8).reverse();
  const spanMin = buffer.length > 1 ? (buffer[buffer.length - 1].t - buffer[0].t) / 60000 : 0;
  const health = byLevel.error > 0 ? "con errores" : byLevel.warn > 0 ? "con avisos" : "sano";
  return { generatedAt: Date.now(), total: buffer.length, byLevel, bySource, lastErrors, lastWarns, spanMin, health };
}

const ts = (t: number) => new Date(t).toLocaleTimeString("es-ES");

export function reportToText(r: AuditReport): string {
  const L: string[] = [];
  L.push("═══ INFORME DE AUDITORÍA · LIQRADAR ═══");
  L.push(`Generado: ${new Date(r.generatedAt).toLocaleString("es-ES")}`);
  L.push(`Estado general: ${r.health.toUpperCase()}`);
  L.push(`Eventos registrados: ${r.total} (últimos ${r.spanMin.toFixed(0)} min)`);
  L.push("");
  L.push("— Conteo por nivel —");
  L.push(`  errores: ${r.byLevel.error} · avisos: ${r.byLevel.warn} · ok: ${r.byLevel.ok} · info: ${r.byLevel.info}`);
  L.push("— Conteo por origen —");
  L.push(
    `  motor: ${r.bySource.motor} · datos: ${r.bySource.datos} · mtf: ${r.bySource.confluencia} · agente: ${r.bySource.agente} · sistema: ${r.bySource.sistema} · ui: ${r.bySource.ui}`
  );
  if (r.lastErrors.length) {
    L.push("");
    L.push("— Últimos ERRORES (requieren corrección) —");
    r.lastErrors.forEach((e) => L.push(`  [${ts(e.t)}] ${e.msg}${e.detail ? ` · ${e.detail}` : ""}`));
  } else {
    L.push("");
    L.push("— Sin errores registrados ✓ —");
  }
  if (r.lastWarns.length) {
    L.push("");
    L.push("— Últimos AVISOS —");
    r.lastWarns.forEach((e) => L.push(`  [${ts(e.t)}] ${e.msg}`));
  }
  L.push("");
  L.push("═══ FIN DEL INFORME ═══");
  return L.join("\n");
}

export function eventsToCsv(events: AuditEvent[]): string {
  const head = "id;timestamp;nivel;origen;mensaje;detalle";
  const rows = events.map((e) =>
    [e.id, new Date(e.t).toISOString(), e.level, e.source, `"${e.msg.replace(/"/g, "'")}"`, `"${(e.detail ?? "").replace(/"/g, "'")}"`].join(";")
  );
  return "\uFEFF" + [head, ...rows].join("\n");
}
