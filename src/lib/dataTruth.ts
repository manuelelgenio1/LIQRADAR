/* ============================================================
   Data Truth — proveniencia de cada dato del radar.
   REAL        = observado directamente del exchange
   ESTIMATED   = derivado por un modelo (clusters futuros, absorción…)
   UNAVAILABLE = sin datos (la señal se degrada o se bloquea)
   CONNECTING  = estableciendo conexión
   Nunca se convierte "desconocido" en dato de mercado.
   ============================================================ */

export type TruthState = "real" | "estimated" | "unavailable" | "connecting";

export interface SourceStatus {
  id: string;
  label: string;
  state: TruthState;
  lastUpdate: number; // ms epoch (0 = nunca)
  note?: string;
}

const registry = new Map<string, SourceStatus>();
const listeners = new Set<() => void>();
let version = 0;

export const SOURCES: { id: string; label: string }[] = [
  { id: "precio", label: "Precio spot (WS)" },
  { id: "velas", label: "Velas (REST)" },
  { id: "metricas", label: "Funding · OI · ratios (REST)" },
  { id: "libro", label: "Libro L2 (WS secuenciado)" },
  { id: "trades_spot", label: "Trades spot aggTrade (WS)" },
  { id: "trades_fut", label: "Trades futuros aggTrade (WS)" },
  { id: "liquidaciones", label: "Liquidaciones forceOrder (WS)" },
  { id: "opciones", label: "Opciones BTC (REST)" },
  { id: "topflow", label: "Top-Trader Position Flow (REST)" },
  { id: "okx", label: "OKX (REST)" },
  { id: "bybit", label: "Bybit (REST)" },
];

export function markSource(id: string, state: TruthState, note?: string) {
  registry.set(id, { id, label: SOURCES.find((s) => s.id === id)?.label ?? id, state, lastUpdate: state === "real" ? Date.now() : registry.get(id)?.lastUpdate ?? 0, note });
  version++;
  listeners.forEach((fn) => fn());
}

export function getSources(): SourceStatus[] {
  return SOURCES.map((s) => registry.get(s.id) ?? { ...s, state: "connecting" as TruthState, lastUpdate: 0 });
}

export function getDataTruthVersion(): number {
  return version;
}

export function subscribeDataTruth(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const TRUTH_META: Record<TruthState, { label: string; color: string }> = {
  real: { label: "REAL", color: "#2fd6a5" },
  estimated: { label: "ESTIMADO", color: "#ffb547" },
  unavailable: { label: "SIN DATOS", color: "#ff4d6d" },
  connecting: { label: "CONECTANDO", color: "#3fb6ff" },
};

/* Validación numérica obligatoria: un HTTP 200 no implica dato válido */
export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}
