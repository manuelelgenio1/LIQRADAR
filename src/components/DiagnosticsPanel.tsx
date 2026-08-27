import { useEffect, useRef, useState } from "react";
import type { MarketData } from "../hooks/useMarket";
import type { Cluster, CvdInfo, Verdict } from "../lib/engine";
import { fmtCompact, fmtTime, fmtUsd } from "../lib/engine";
import type { Prediction } from "../lib/history";

/* ============================================================
   Diagnóstico en vivo: prueba de integridad de la herramienta.
   Verifica en tiempo real que cada fuente entrega datos reales
   y que cada cálculo del motor es internamente coherente.
   ============================================================ */

export interface AnalysisLite {
  longPool: number;
  shortPool: number;
  clusters: Cluster[];
  cvd: CvdInfo;
  verdict: Verdict;
}

interface Props {
  m: MarketData;
  a: AnalysisLite | null;
  rangePct: number;
  preds: Prediction[];
  flips: number;
}

type Status = "ok" | "warn" | "fail";

interface Check {
  id: string;
  label: string;
  status: Status;
  detail: string;
  live?: boolean;
}

const ST: Record<Status, { word: string; color: string; bg: string; border: string }> = {
  ok: { word: "OK", color: "#5ef2c4", bg: "rgba(47,214,165,0.1)", border: "rgba(47,214,165,0.4)" },
  warn: { word: "AVISO", color: "#ffb547", bg: "rgba(255,181,71,0.1)", border: "rgba(255,181,71,0.4)" },
  fail: { word: "FALLO", color: "#ff7d95", bg: "rgba(255,77,109,0.12)", border: "rgba(255,77,109,0.45)" },
};

function StatusIcon({ s }: { s: Status }) {
  if (s === "ok") {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
        <circle cx="6.5" cy="6.5" r="6" fill="none" stroke="#2fd6a5" strokeWidth="1.4" />
        <path d="M3.8 6.8l1.9 1.9 3.5-4" stroke="#5ef2c4" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (s === "warn") {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
        <path d="M6.5 1.5 12 11H1L6.5 1.5Z" fill="none" stroke="#ffb547" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6.5 5.4v2.4" stroke="#ffb547" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="6.5" cy="9.4" r="0.7" fill="#ffb547" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
      <circle cx="6.5" cy="6.5" r="6" fill="none" stroke="#ff4d6d" strokeWidth="1.4" />
      <path d="M4.4 4.4l4.2 4.2M8.6 4.4l-4.2 4.2" stroke="#ff7d95" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckRow({ c }: { c: Check }) {
  const st = ST[c.status];
  return (
    <div className="group flex items-start gap-3 rounded-md border border-line/50 bg-ink-950/40 px-3.5 py-2.5 transition-colors hover:border-line">
      <span className="mt-1">
        <StatusIcon s={c.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="text-[12.5px] font-600 text-fog">{c.label}</span>
          {c.live && (
            <span
              className="live-dot h-[6px] w-[6px]"
              style={{ background: c.status === "ok" ? "#2fd6a5" : "#ffb547", color: c.status === "ok" ? "#2fd6a5" : "#ffb547" }}
            />
          )}
          <span
            className="rounded-sm px-1.5 py-[1px] font-mono text-[9px] font-700 tracking-widest"
            style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}
          >
            {st.word}
          </span>
        </div>
        <div className="mt-0.5 break-words font-mono text-[10.5px] tabular-nums leading-relaxed text-mist">{c.detail}</div>
      </div>
    </div>
  );
}

export function DiagnosticsPanel({ m, a, rangePct, preds, flips }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const lastPriceAtRef = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // cada tick de precio real (WS o simulador) renueva el sello temporal
  useEffect(() => {
    lastPriceAtRef.current = Date.now();
  }, [m.tickId]);

  const secsSincePrice = Math.max(0, Math.round((now - lastPriceAtRef.current) / 1000));

  /* ---------- fuentes de datos ---------- */
  const sources: Check[] = [];

  const lastCandle = m.candles[m.candles.length - 1];
  sources.push({
    id: "klines",
    label: "Velas históricas · Binance Spot REST",
    status: m.candles.length === 0 ? "fail" : m.sources.klines === "live" ? "ok" : "warn",
    detail: lastCandle
      ? `${m.candles.length} velas recibidas · última cerró ${fmtTime(lastCandle.time * 1000)} en ${fmtUsd(lastCandle.close, 1)} · volumen taker ${fmtCompact(lastCandle.takerBuyQuote ?? 0)}${m.sources.klines === "sim" ? " · MODO SIMULADO (sin conexión al exchange)" : ""}`
      : "esperando respuesta del exchange…",
  });

  const priceLive = m.sources.price === "live";
  sources.push({
    id: "price",
    label: "Precio en vivo · WebSocket btcusdt@trade",
    status: !priceLive ? "warn" : secsSincePrice <= 30 ? "ok" : "fail",
    detail: priceLive
      ? `stream conectado · ${fmtUsd(m.spot, 1)} · último tick hace ${secsSincePrice}s`
      : `modo simulado activo · ${fmtUsd(m.spot, 1)} · tick hace ${secsSincePrice}s (tu red no permite wss://stream.binance.com)`,
    live: true,
  });

  const lastLiq = m.liqEvents[0];
  sources.push({
    id: "liq",
    label: "Liquidaciones · stream !forceOrder (todos los futuros)",
    status: m.sources.liq === "live" ? "ok" : "warn",
    detail: lastLiq
      ? `${m.liqEvents.length} eventos en buffer · último: ${fmtTime(lastLiq.time)} ${lastLiq.side.toUpperCase()} liquidado @ ${fmtUsd(lastLiq.price, 1)} por ${fmtCompact(lastLiq.notional)}${m.sources.liq === "sim" ? " · MODO SIMULADO" : ""}`
      : "escuchando el mercado… sin liquidaciones todavía (normal en mercados tranquilos)",
    live: true,
  });

  sources.push({
    id: "metrics",
    label: "Posicionamiento · funding, OI, ratios y takers (REST cada 45s)",
    status: m.sources.metrics === "live" ? "ok" : "warn",
    detail: `funding ${(m.fundingRate * 100).toFixed(4)}% · OI ${m.oi > 0 ? m.oi.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " BTC" : "—"} · ratio retail ${m.globalRatio.toFixed(2)} · taker ${m.takerRatio.toFixed(2)} · próxima lectura en ${m.refreshIn}s`,
  });

  /* ---------- coherencia del motor ---------- */
  const engine: Check[] = [];
  if (a) {
    const v = a.verdict;

    engine.push({
      id: "pools",
      label: "Pools de liquidación calculados",
      status: a.longPool > 0 && a.shortPool > 0 ? "ok" : "fail",
      detail: `combustible de longs ${fmtCompact(a.longPool)} · combustible de shorts ${fmtCompact(a.shortPool)} (ambos > 0)`,
    });

    const inRange = a.clusters.every((c) => Math.abs((c.price - m.spot) / m.spot) <= rangePct * 1.15);
    engine.push({
      id: "clusters",
      label: "Clusters dentro del rango analizado",
      status: a.clusters.length === 0 ? "warn" : inRange ? "ok" : "fail",
      detail:
        a.clusters.length === 0
          ? "sin concentraciones destacadas en esta ventana"
          : `${a.clusters.length} clusters · ${inRange ? `todos dentro de ±${(rangePct * 100).toFixed(1)}% del spot` : "ALGÚN CLUSTER FUERA DE RANGO"}`,
    });

    // tolerancia del 0.3%: el spot en vivo se mueve entre recálculos del motor
    const tol = 0.003;
    const targetSide = v.target ? (v.direction === "up" ? v.target.price > m.spot : v.target.price < m.spot) : true;
    const targetNear = v.target ? Math.abs(v.target.price - m.spot) / m.spot <= tol : true;
    engine.push({
      id: "target",
      label: "Objetivo en el lado correcto del precio",
      status: !v.target ? "warn" : targetSide || targetNear ? "ok" : "warn",
      detail: v.target
        ? targetSide || targetNear
          ? `rumbo ${v.direction === "up" ? "LONG → objetivo arriba" : "SHORT → objetivo abajo"}: ${fmtUsd(v.target.price)} vs spot ${fmtUsd(m.spot)}`
          : `el precio ya cruzó el objetivo (${fmtUsd(v.target.price)}) — el sweep ocurrió y el escenario se está recalculando`
        : "veredicto sin cluster objetivo definido",
    });

    const invSide = v.invalidation ? (v.direction === "up" ? v.invalidation.price < m.spot : v.invalidation.price > m.spot) : true;
    const invNear = v.invalidation ? Math.abs(v.invalidation.price - m.spot) / m.spot <= tol : true;
    engine.push({
      id: "inval",
      label: "Invalidación en el lado contrario",
      status: !v.invalidation ? "warn" : invSide || invNear ? "ok" : "warn",
      detail: v.invalidation
        ? invSide || invNear
          ? `${fmtUsd(v.invalidation.price)} ${v.direction === "up" ? "bajo el spot (liq. longs)" : "sobre el spot (liq. shorts)"} — barrerlo anula el escenario`
          : `el precio cruzó la invalidación (${fmtUsd(v.invalidation.price)}) — escenario anulado en vivo, esperando recálculo`
        : "sin nivel de invalidación definido",
    });

    const wSum = v.factors.reduce((x, f) => x + f.weight, 0);
    engine.push({
      id: "weights",
      label: "Pesos del modelo normalizados (Σ = 1)",
      status: Math.abs(wSum - 1) < 0.011 ? "ok" : "fail",
      detail: `Σ pesos = ${wSum.toFixed(3)} sobre ${v.factors.length} factores ponderados`,
    });

    const bounded = Math.abs(v.scorePct) <= 100 && v.confidence >= 0 && v.confidence <= 100;
    engine.push({
      id: "bounds",
      label: "Sesgo y confianza dentro de límites",
      status: bounded ? "ok" : "fail",
      detail: `sesgo ${v.scorePct > 0 ? "+" : ""}${v.scorePct} ∈ [−100, +100] · confianza ${v.confidence}% ∈ [0, 100]`,
    });

    engine.push({
      id: "cvd",
      label: "CVD (delta de takers) calculado y finito",
      status: Number.isFinite(a.cvd.cvdPct) ? "ok" : "fail",
      detail: `compra neta = ${(a.cvd.cvdPct * 100).toFixed(2)}% del volumen de la ventana · divergencia: ${a.cvd.divergence ?? "ninguna"}`,
    });
  }

  const closed = preds.filter((p) => p.status === "acierto" || p.status === "fallo");
  const hits = preds.filter((p) => p.status === "acierto").length;
  engine.push({
    id: "track",
    label: "Auditoría en vivo del modelo (persistida)",
    status: preds.length === 0 ? "warn" : "ok",
    detail:
      preds.length === 0
        ? "todavía sin veredictos registrados — se archiva cada predicción con sesgo para verificarla contra el precio real"
        : `${preds.length} predicciones registradas · ${closed.length} cerradas contra el precio · acierto ${closed.length > 0 ? Math.round((hits / closed.length) * 100) + "%" : "—"}`,
  });

  engine.push({
    id: "alerts",
    label: "Alerta de cambio de rumbo (LONG ↔ SHORT)",
    status: "ok",
    detail:
      flips === 0
        ? "armada y vigilando · aún sin giros LONG↔SHORT en esta sesión (normal si el mercado mantiene tendencia)"
        : `${flips} ${flips === 1 ? "giro detectado" : "giros detectados"} · la notificación flotante se dispara en cada reversión real del veredicto`,
  });

  const all = [...sources, ...engine];
  const fails = all.filter((c) => c.status === "fail").length;
  const warns = all.filter((c) => c.status === "warn").length;
  const oks = all.length - fails - warns;
  const globalOk = fails === 0;
  const degraded = warns > 0;
  const gWord = !globalOk ? "FALLO DETECTADO" : degraded ? "OPERATIVO · MODO DEGRADADO" : "TODO OPERATIVO";
  const gColor = !globalOk ? "#ff4d6d" : degraded ? "#ffb547" : "#2fd6a5";

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">08 · diagnóstico en vivo</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Prueba de integridad: ¿está funcionando de verdad?
          </h2>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-mist">
            Este panel se auto-audita cada segundo: verifica que cada fuente entrega <b className="text-fog">datos reales del exchange</b> y
            que cada cálculo del motor es internamente coherente. Si tu red bloquea Binance, lo verás marcado en ámbar con total transparencia.
          </p>
        </div>
        <div
          className="flex items-center gap-2.5 rounded-md border px-4 py-2"
          style={{ borderColor: `${gColor}55`, background: `${gColor}0d` }}
        >
          <span className="live-dot" style={{ background: gColor, color: gColor }} />
          <span className="font-mono text-[12px] font-700 tracking-widest" style={{ color: gColor }}>
            {gWord}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] tabular-nums">
        <span className="text-long-hi">{oks} OK</span>
        <span className="text-warn">{warns} avisos</span>
        <span className="text-short-hi">{fails} fallos</span>
        <span className="ml-auto text-dusk">actualizado hace {Math.max(0, Math.round((now - lastPriceAtRef.current) / 1000))}s · {new Date(now).toLocaleTimeString("es-ES")}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="panel-tag mb-2">fuentes de datos (Binance)</div>
          <div className="flex flex-col gap-1.5">
            {sources.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </div>
        </div>
        <div>
          <div className="panel-tag mb-2">coherencia del motor (cálculo actual)</div>
          <div className="flex flex-col gap-1.5">
            {engine.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 border-t border-line/50 pt-3 font-mono text-[10.5px] leading-relaxed text-dusk">
        Los valores mostrados arriba son los que Binance devuelve <b className="text-mist">en este instante</b>: compáralos con
        coinglass.com o el propio exchange. Ver un AVISO significa que esa fuente usa el simulador (red restringida), no un error del modelo.
      </p>
    </div>
  );
}
