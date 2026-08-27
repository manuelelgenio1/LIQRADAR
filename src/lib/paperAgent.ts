/* ============================================================
   Agente LiqRadar — motor autónomo de paper trading.
   Vigila el radar en vivo y actúa cuando se cumplen las reglas:
   abre posiciones paper, gestiona objetivo/invalidación y
   registra cada operación con PnL y múltiplos de R.
   ============================================================ */

import type { Verdict } from "./engine";

export type Autonomy = "alerts" | "auto";

export interface AgentRules {
  on: boolean;
  autonomy: Autonomy; // alerts = solo avisa · auto = abre posiciones paper
  minBias: number; // |sesgo| mínimo (0..100)
  minConf: number; // confianza mínima del radar
  minConfluence: number; // acuerdo MTF mínimo (0..3)
  riskPct: number; // % del capital paper arriesgado por operación
  cooldownSec: number; // espera mínima entre operaciones
  capital: number; // capital paper en USDT
}

export interface AgentPosition {
  id: string;
  side: "long" | "short";
  entry: number;
  qtyBtc: number;
  notional: number;
  target: number;
  stop: number;
  openedAt: number;
  bias: number;
  confidence: number;
  confluence: number;
  reason: string;
}

export type ExitReason = "objetivo" | "invalidación" | "giro" | "manual";

export interface AgentTrade {
  id: string;
  side: "long" | "short";
  entry: number;
  exit: number;
  pnlPct: number; // % de precio
  pnlR: number; // múltiplos de R
  pnlUsd: number;
  openedAt: number;
  closedAt: number;
  exitReason: ExitReason;
}

export interface LogEntry {
  id: string;
  t: number;
  kind: "info" | "open" | "close" | "warn" | "signal";
  text: string;
}

export interface AgentState {
  position: AgentPosition | null;
  trades: AgentTrade[];
  log: LogEntry[];
  equity: number; // capital paper actual
  curve: number[]; // curva de equity
  lastOpAt: number; // cooldown
}

export const DEFAULT_RULES: AgentRules = {
  on: false,
  autonomy: "alerts",
  minBias: 40,
  minConf: 55,
  minConfluence: 2,
  riskPct: 1,
  cooldownSec: 300,
  capital: 1000,
};

const LS_RULES = "liqradar-agent-rules-v1";
const LS_STATE = "liqradar-agent-state-v1";

export function loadAgentRules(): AgentRules {
  try {
    const raw = localStorage.getItem(LS_RULES);
    if (raw) return { ...DEFAULT_RULES, ...(JSON.parse(raw) as Partial<AgentRules>) };
  } catch {
    /* noop */
  }
  return { ...DEFAULT_RULES };
}

export function saveAgentRules(r: AgentRules) {
  try {
    localStorage.setItem(LS_RULES, JSON.stringify(r));
  } catch {
    /* noop */
  }
}

export function loadAgentState(capital: number): AgentState {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) {
      const s = JSON.parse(raw) as AgentState;
      return { ...s, position: s.position ?? null, trades: s.trades ?? [], log: s.log ?? [], curve: s.curve ?? [capital] };
    }
  } catch {
    /* noop */
  }
  return { position: null, trades: [], log: [], equity: capital, curve: [capital], lastOpAt: 0 };
}

export function saveAgentState(s: AgentState) {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify({ ...s, log: s.log.slice(0, 40), curve: s.curve.slice(-200) }));
  } catch {
    /* noop */
  }
}

const uid = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export function pushLog(s: AgentState, kind: LogEntry["kind"], text: string): AgentState {
  return { ...s, log: [{ id: uid(), t: Date.now(), kind, text }, ...s.log].slice(0, 40) };
}

/* ¿La señal actual califica según las reglas? Devuelve razones legibles */
export function evaluateSignal(
  rules: AgentRules,
  v: Verdict,
  confluenceAgree: number,
  confluenceDir: "up" | "down" | "mixed" | null
): { go: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let go = true;
  if (v.direction === "neutral") {
    go = false;
    reasons.push("el radar está en NEUTRO — sin rumbo definido");
  }
  if (Math.abs(v.scorePct) < rules.minBias) {
    go = false;
    reasons.push(`sesgo |${v.scorePct}| < mínimo ${rules.minBias}`);
  }
  if (v.confidence < rules.minConf) {
    go = false;
    reasons.push(`confianza ${v.confidence}% < mínima ${rules.minConf}%`);
  }
  if (confluenceAgree < rules.minConfluence) {
    go = false;
    reasons.push(`confluencia ${confluenceAgree}/3 < mínima ${rules.minConfluence}/3`);
  }
  if (confluenceDir && confluenceDir !== "mixed" && v.direction !== "neutral" && confluenceDir !== v.direction) {
    go = false;
    reasons.push(`los timeframes apuntan en contra (${confluenceDir === "up" ? "LONG" : "SHORT"})`);
  }
  if (!v.target || !v.invalidation) {
    go = false;
    reasons.push("el radar no tiene objetivo/invalidación definidos");
  }
  return { go, reasons };
}

export function openPosition(
  s: AgentState,
  rules: AgentRules,
  v: Verdict,
  confluenceAgree: number,
  spot: number
): AgentState {
  if (!v.target || !v.invalidation || v.direction === "neutral") return s;
  const side: "long" | "short" = v.direction === "up" ? "long" : "short";
  const riskDist = Math.abs(spot - v.invalidation.price);
  if (riskDist <= 0) return pushLog(s, "warn", "distancia a la invalidación nula — no se abrió posición");
  const riskUsd = (s.equity * rules.riskPct) / 100;
  const qtyBtc = riskUsd / riskDist;
  const notional = qtyBtc * spot;
  const pos: AgentPosition = {
    id: uid(),
    side,
    entry: spot,
    qtyBtc,
    notional,
    target: v.target.price,
    stop: v.invalidation.price,
    openedAt: Date.now(),
    bias: v.scorePct,
    confidence: v.confidence,
    confluence: confluenceAgree,
    reason: v.headline,
  };
  let next: AgentState = { ...s, position: pos, lastOpAt: Date.now() };
  next = pushLog(
    next,
    "open",
    `${side === "long" ? "▲ LONG" : "▼ SHORT"} abierto @ $${Math.round(spot).toLocaleString("en-US")} · ` +
      `${qtyBtc.toFixed(5)} BTC · objetivo $${Math.round(pos.target).toLocaleString("en-US")} · stop $${Math.round(pos.stop).toLocaleString("en-US")} · ` +
      `riesgo $${riskUsd.toFixed(0)} (${rules.riskPct}%)`
  );
  return next;
}

/* PnL en vivo de la posición abierta */
export function markToMarket(p: AgentPosition, spot: number): { pnlPct: number; pnlUsd: number; pnlR: number } {
  const dirMul = p.side === "long" ? 1 : -1;
  const pnlPct = ((spot - p.entry) / p.entry) * 100 * dirMul;
  const pnlUsd = (spot - p.entry) * p.qtyBtc * dirMul;
  const riskDistPct = (Math.abs(p.entry - p.stop) / p.entry) * 100;
  const pnlR = riskDistPct > 0 ? pnlPct / riskDistPct : 0;
  return { pnlPct, pnlUsd, pnlR };
}

/* Salidas: objetivo, invalidación o giro fuerte del radar en contra */
export function checkExits(
  s: AgentState,
  rules: AgentRules,
  v: Verdict,
  spot: number
): { exit: ExitReason | null; next: AgentState } {
  const p = s.position;
  if (!p) return { exit: null, next: s };

  const hitTarget = p.side === "long" ? spot >= p.target : spot <= p.target;
  const hitStop = p.side === "long" ? spot <= p.stop : spot >= p.stop;
  const against =
    v.direction !== "neutral" &&
    ((p.side === "long" && v.direction === "down") || (p.side === "short" && v.direction === "up")) &&
    Math.abs(v.scorePct) >= 30;

  let reason: ExitReason | null = null;
  if (hitTarget && hitStop) reason = Math.abs(spot - p.target) <= Math.abs(spot - p.stop) ? "objetivo" : "invalidación";
  else if (hitTarget) reason = "objetivo";
  else if (hitStop) reason = "invalidación";
  else if (against) reason = "giro";
  if (!reason) return { exit: null, next: s };

  return { exit: reason, next: closePosition(s, rules, spot, reason) };
}

export function closePosition(s: AgentState, rules: AgentRules, spot: number, reason: ExitReason): AgentState {
  const p = s.position;
  if (!p) return s;
  const { pnlPct, pnlUsd, pnlR } = markToMarket(p, spot);
  const trade: AgentTrade = {
    id: p.id,
    side: p.side,
    entry: p.entry,
    exit: spot,
    pnlPct,
    pnlR,
    pnlUsd,
    openedAt: p.openedAt,
    closedAt: Date.now(),
    exitReason: reason,
  };
  // el equity crece/decrece según el R obtenido sobre el % arriesgado
  const equity = Math.max(0, s.equity * (1 + (pnlR * rules.riskPct) / 100));
  let next: AgentState = {
    ...s,
    position: null,
    trades: [trade, ...s.trades].slice(0, 60),
    equity,
    curve: [...s.curve, equity].slice(-200),
    lastOpAt: Date.now(),
  };
  const win = pnlUsd >= 0;
  next = pushLog(
    next,
    "close",
    `${p.side === "long" ? "▲ LONG" : "▼ SHORT"} cerrado por ${reason.toUpperCase()} @ $${Math.round(spot).toLocaleString("en-US")} · ` +
      `${win ? "+" : ""}${pnlPct.toFixed(2)}% · ${win ? "+" : ""}${pnlR.toFixed(2)}R · ${win ? "+" : "−"}$${Math.abs(pnlUsd).toFixed(2)}`
  );
  return next;
}

/* Estadísticas agregadas del agente */
export function agentStats(s: AgentState) {
  const closed = s.trades;
  const wins = closed.filter((t) => t.pnlUsd >= 0).length;
  const losses = closed.length - wins;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  const totalR = closed.reduce((a, t) => a + t.pnlR, 0);
  const totalUsd = closed.reduce((a, t) => a + t.pnlUsd, 0);
  const avgR = closed.length > 0 ? totalR / closed.length : 0;
  const best = closed.length > 0 ? Math.max(...closed.map((t) => t.pnlR)) : 0;
  const worst = closed.length > 0 ? Math.min(...closed.map((t) => t.pnlR)) : 0;
  const byObjective = closed.filter((t) => t.exitReason === "objetivo").length;
  const byStop = closed.filter((t) => t.exitReason === "invalidación").length;
  const byFlip = closed.filter((t) => t.exitReason === "giro").length;
  return { closed: closed.length, wins, losses, winRate, totalR, totalUsd, avgR, best, worst, byObjective, byStop, byFlip };
}
