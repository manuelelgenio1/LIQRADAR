import { useCallback, useEffect, useRef, useState } from "react";
import type { Verdict } from "../lib/engine";
import type { ConfluenceState } from "./useConfluence";
import {
  checkExits,
  closePosition,
  evaluateSignal,
  loadAgentRules,
  loadAgentState,
  openPosition,
  pushLog,
  saveAgentRules,
  saveAgentState,
  type AgentRules,
  type AgentState,
} from "../lib/paperAgent";
import { playConfirm, playMagnet } from "../lib/sound";

/* ============================================================
   Hook del agente autónomo: vigila el radar en vivo y actúa
   según las reglas (abre/cierra posiciones paper, avisa, registra).
   ============================================================ */

export function usePaperAgent(
  verdict: Verdict | null,
  spot: number,
  confluence: ConfluenceState,
  soundOn: boolean,
  sendWebhook: (event: string, payload: Record<string, unknown>) => void
) {
  const [rules, setRulesState] = useState<AgentRules>(loadAgentRules);
  const [state, setState] = useState<AgentState>(() => loadAgentState(loadAgentRules().capital));

  const stateRef = useRef(state);
  stateRef.current = state;
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const lastSignalKey = useRef("");

  const setRules = useCallback((r: AgentRules) => {
    setRulesState(r);
    saveAgentRules(r);
  }, []);

  // persistencia del estado del agente
  useEffect(() => {
    saveAgentState(state);
  }, [state]);

  // avisos de encendido/apagado/cambio de autonomía
  useEffect(() => {
    setState((s) =>
      pushLog(
        s,
        "info",
        rules.on
          ? `agente ENCENDIDO · autonomía ${rules.autonomy === "auto" ? "AUTO PAPER" : "SOLO ALERTAS"} · sesgo≥${rules.minBias} · conf≥${rules.minConf}% · confl≥${rules.minConfluence}/3`
          : "agente APAGADO — no vigilará las señales"
      )
    );
  }, [rules.on, rules.autonomy]);

  // bucle principal del agente
  useEffect(() => {
    if (!rules.on || !verdict || !Number.isFinite(spot) || spot <= 0) return;
    const s = stateRef.current;
    const agree = Math.round(confluence.grade / 33.34);

    // 1) gestionar la posición abierta (objetivo / invalidación / giro)
    if (s.position) {
      const { exit, next } = checkExits(s, rules, verdict, spot);
      if (exit) {
        setState(next);
        if (soundOn) playMagnet();
        sendWebhook("cierre_agente", {
          lado: s.position.side,
          entrada: s.position.entry,
          salida: spot,
          motivo: exit,
          mensaje: `Agente cerró ${s.position.side.toUpperCase()} por ${exit} @ $${Math.round(spot).toLocaleString("en-US")}`,
        });
      }
      return;
    }

    // 2) evaluar la señal actual contra las reglas
    const { go, reasons } = evaluateSignal(rules, verdict, agree, confluence.alignedDir);
    if (!go) return;
    const now = Date.now();
    if (now - s.lastOpAt < rules.cooldownSec * 1000) return;

    const sideWord = verdict.direction === "up" ? "▲ LONG" : "▼ SHORT";
    const base = `SEÑAL CALIFICADA ${sideWord} · sesgo ${verdict.scorePct > 0 ? "+" : ""}${verdict.scorePct} · conf ${verdict.confidence}% · confl ${agree}/3`;

    if (rules.autonomy === "alerts") {
      // solo avisar, sin repetir la misma señal
      const key = `${verdict.direction}-${Math.round(verdict.scorePct / 10)}-${Math.round(verdict.confidence / 10)}`;
      if (key === lastSignalKey.current) return;
      lastSignalKey.current = key;
      setState(pushLog(s, "signal", `${base} — autonomía SOLO ALERTAS: no se abrió posición`));
      if (soundOn) playConfirm();
      sendWebhook("senal_agente", {
        lado: verdict.direction,
        sesgo: verdict.scorePct,
        confianza: verdict.confidence,
        confluencia: agree,
        spot,
        objetivo: verdict.target?.price ?? null,
        invalidacion: verdict.invalidation?.price ?? null,
        mensaje: `${base} @ $${Math.round(spot).toLocaleString("en-US")}`,
      });
      return;
    }

    // 3) autonomía AUTO: abrir posición paper
    const next = openPosition(s, rules, verdict, agree, spot);
    if (next !== s) {
      setState(next);
      if (soundOn) playConfirm();
      sendWebhook("apertura_agente", {
        lado: verdict.direction,
        entrada: spot,
        objetivo: verdict.target?.price ?? null,
        invalidacion: verdict.invalidation?.price ?? null,
        sesgo: verdict.scorePct,
        confianza: verdict.confidence,
        confluencia: agree,
        razones: reasons,
        mensaje: `${base} → posición abierta @ $${Math.round(spot).toLocaleString("en-US")}`,
      });
    }
  }, [verdict, spot, rules, confluence.grade, confluence.alignedDir, soundOn, sendWebhook]);

  const closeNow = useCallback(() => {
    const s = stateRef.current;
    if (!s.position) return;
    setState(closePosition(s, rulesRef.current, spotRef.current, "manual"));
  }, []);

  const reset = useCallback(() => {
    const r = rulesRef.current;
    const fresh: AgentState = {
      position: null,
      trades: [],
      log: [],
      equity: r.capital,
      curve: [r.capital],
      lastOpAt: 0,
    };
    setState(pushLog(fresh, "info", "historial reiniciado · equity restablecido"));
  }, []);

  return { rules, setRules, state, closeNow, reset };
}
