import { useEffect, useMemo, useState } from "react";
import type { Verdict } from "../lib/engine";
import { fmtUsd } from "../lib/engine";

/* ============================================================
   Diario de trading: registra operaciones (idealmente las que
   tomaste siguiendo las señales del radar) y mide tu rendimiento
   en múltiplos de R. Persiste en el navegador.
   ============================================================ */

interface Trade {
  id: string;
  side: "long" | "short";
  entry: number;
  target: number;
  stop: number;
  sizeUsd: number;
  notes: string;
  createdAt: number;
  status: "abierta" | "ganada" | "perdida";
  closedAt?: number;
}

const KEY = "liqradar-journal-v1";

function load(): Trade[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Trade[];
  } catch {
    /* noop */
  }
  return [];
}

/** R de una operación cerrada: ganada paga el ratio riesgo/beneficio, perdida −1R */
function tradeR(t: Trade): number {
  const risk = Math.abs(t.entry - t.stop);
  if (risk <= 0) return 0;
  const reward = Math.abs(t.target - t.entry);
  return t.status === "ganada" ? reward / risk : t.status === "perdida" ? -1 : 0;
}

interface FormState {
  side: "long" | "short";
  entry: string;
  target: string;
  stop: string;
  sizeUsd: string;
  notes: string;
}

const empty: FormState = { side: "long", entry: "", target: "", stop: "", sizeUsd: "", notes: "" };

export function Journal({ spot, verdict }: { spot: number; verdict: Verdict | null }) {
  const [trades, setTrades] = useState<Trade[]>(load);
  const [form, setForm] = useState(empty);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(trades));
    } catch {
      /* noop */
    }
  }, [trades]);

  // detección automática: si el spot cruza target/stop de una operación abierta, se cierra sola
  useEffect(() => {
    if (!Number.isFinite(spot) || spot <= 0) return;
    setTrades((ts) =>
      ts.map((t) => {
        if (t.status !== "abierta") return t;
        if (t.side === "long") {
          if (spot >= t.target) return { ...t, status: "ganada", closedAt: Date.now() };
          if (spot <= t.stop) return { ...t, status: "perdida", closedAt: Date.now() };
        } else {
          if (spot <= t.target) return { ...t, status: "ganada", closedAt: Date.now() };
          if (spot >= t.stop) return { ...t, status: "perdida", closedAt: Date.now() };
        }
        return t;
      })
    );
  }, [spot]);

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.status !== "abierta");
    const wins = closed.filter((t) => t.status === "ganada");
    const losses = closed.filter((t) => t.status === "perdida");
    const rs = closed.map(tradeR);
    const cum = rs.reduce((a, b) => a + b, 0);
    return {
      total: trades.length,
      open: trades.length - closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : null,
      avgR: rs.length > 0 ? cum / rs.length : null,
      cumR: cum,
    };
  }, [trades]);

  const useSignal = () => {
    if (!verdict || !verdict.target || !verdict.invalidation) return;
    const target = verdict.target.price;
    const stop = verdict.invalidation.price;
    const side: FormState["side"] = verdict.direction === "down" ? "short" : "long";
    setForm((f) => ({
      ...f,
      side,
      entry: String(Math.round(spot)),
      target: String(Math.round(target)),
      stop: String(Math.round(stop)),
    }));
  };

  const submit = () => {
    const entry = Number(form.entry);
    const target = Number(form.target);
    const stop = Number(form.stop);
    if (![entry, target, stop].every((x) => Number.isFinite(x) && x > 0)) return;
    setTrades((ts) => [
      {
        id: `${Date.now()}`,
        side: form.side,
        entry,
        target,
        stop,
        sizeUsd: Number(form.sizeUsd) > 0 ? Number(form.sizeUsd) : 0,
        notes: form.notes.trim(),
        createdAt: Date.now(),
        status: "abierta",
      },
      ...ts,
    ]);
    setForm(empty);
  };

  const setStatus = (id: string, status: Trade["status"]) =>
    setTrades((ts) => ts.map((t) => (t.id === id ? { ...t, status, closedAt: status === "abierta" ? undefined : Date.now() } : t)));
  const remove = (id: string) => setTrades((ts) => ts.filter((t) => t.id !== id));

  const rColor = (r: number) => (r > 0 ? "#2fd6a5" : r < 0 ? "#ff4d6d" : "#93a5c8");

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">diario de trading · tu rendimiento</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Registra y mide tus operaciones
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El radar te da la señal; el diario mide <b className="text-fog">cómo la operas tú</b>. Anota entrada, objetivo
            e invalidación — si el precio los cruza mientras la app está abierta, la operación se cierra sola. Todo en
            múltiplos de R, que es como se mide la consistencia.
          </p>
        </div>
        <button className="chip on" onClick={useSignal} title="Rellena el formulario con la señal actual del radar">
          ⚡ usar señal actual
        </button>
      </div>

      {/* estadísticas */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "operaciones", val: String(stats.total), color: "#e9f1ff" },
          { label: "abiertas", val: String(stats.open), color: "#3fb6ff" },
          { label: "ganadas", val: String(stats.wins), color: "#2fd6a5" },
          { label: "perdidas", val: String(stats.losses), color: "#ff4d6d" },
          { label: "win rate", val: stats.winRate === null ? "—" : `${Math.round(stats.winRate)}%`, color: stats.winRate === null ? "#93a5c8" : stats.winRate >= 50 ? "#2fd6a5" : "#ff4d6d" },
          { label: "R acumulado", val: stats.cumR === 0 ? "0R" : `${stats.cumR > 0 ? "+" : ""}${stats.cumR.toFixed(1)}R`, color: rColor(stats.cumR) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-line/50 bg-ink-950/40 px-3.5 py-3 transition-transform duration-200 hover:-translate-y-0.5">
            <div className="panel-tag">{s.label}</div>
            <div className="mt-1 font-mono text-xl font-700 tabular-nums" style={{ color: s.color }}>
              {s.val}
            </div>
          </div>
        ))}
      </div>

      {/* formulario */}
      <div className="mt-4 flex flex-wrap items-end gap-2.5 rounded-lg border border-line/60 bg-ink-950/40 p-3.5">
        <div className="flex overflow-hidden rounded-md border border-line">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setForm((f) => ({ ...f, side: s }))}
              className="px-3.5 py-1.5 font-mono text-[11px] font-700 tracking-widest transition-colors"
              style={
                form.side === s
                  ? s === "long"
                    ? { background: "rgba(47,214,165,0.15)", color: "#5ef2c4" }
                    : { background: "rgba(255,77,109,0.15)", color: "#ff7d95" }
                  : { color: "#5d7099" }
              }
            >
              {s === "long" ? "LONG" : "SHORT"}
            </button>
          ))}
        </div>
        {[
          { k: "entry", label: "Entrada", ph: "precio" },
          { k: "target", label: "Objetivo", ph: "precio" },
          { k: "stop", label: "Stop", ph: "precio" },
          { k: "sizeUsd", label: "Tamaño ($)", ph: "nocional" },
        ].map((f) => (
          <label key={f.k} className="flex flex-col gap-1">
            <span className="panel-tag">{f.label}</span>
            <input
              type="number"
              value={form[f.k as keyof typeof form] as string}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.k]: e.target.value }))}
              placeholder={f.ph}
              className="w-28 rounded-md border border-line bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-fog outline-none transition-colors focus:border-pulse/60"
            />
          </label>
        ))}
        <label className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="panel-tag">notas</span>
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="¿por qué entraste?"
            className="rounded-md border border-line bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] text-fog outline-none transition-colors placeholder:text-dusk focus:border-pulse/60"
          />
        </label>
        <button className="chip on" onClick={submit}>
          ＋ registrar
        </button>
      </div>

      {/* lista */}
      <div className="slim-scroll mt-4 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 320, minHeight: 120 }}>
        {trades.length === 0 && (
          <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-line/60 font-mono text-[11px] text-dusk">
            AÚN SIN OPERACIONES REGISTRADAS — usa «⚡ usar señal actual» para empezar
          </div>
        )}
        {trades.map((t) => {
          const r = tradeR(t);
          const sideColor = t.side === "long" ? "#5ef2c4" : "#ff7d95";
          return (
            <div key={t.id} className="feed-in flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-line/40 bg-ink-950/30 px-3 py-2 font-mono text-[11px] tabular-nums transition-colors hover:border-line">
              <span className="w-14 rounded-sm px-1.5 py-0.5 text-center text-[9.5px] font-700 tracking-wider" style={{ color: sideColor, border: `1px solid ${sideColor}44`, background: `${sideColor}0f` }}>
                {t.side === "long" ? "LONG" : "SHORT"}
              </span>
              <span className="text-mist">
                {fmtUsd(t.entry)} → <span className="text-long-hi">{fmtUsd(t.target)}</span> / <span className="text-short-hi">{fmtUsd(t.stop)}</span>
              </span>
              {t.sizeUsd > 0 && <span className="text-dusk">${t.sizeUsd.toLocaleString("en-US")}</span>}
              {t.notes && <span className="max-w-[220px] truncate text-[10px] italic text-dusk" title={t.notes}>“{t.notes}”</span>}
              <span className="ml-auto flex items-center gap-2">
                {t.status === "abierta" ? (
                  <>
                    <span className="rounded-sm bg-pulse/10 px-1.5 py-0.5 text-[9.5px] font-700 text-pulse">ABIERTA</span>
                    <button className="chip" onClick={() => setStatus(t.id, "ganada")}>✓ ganada</button>
                    <button className="chip" onClick={() => setStatus(t.id, "perdida")}>✕ perdida</button>
                  </>
                ) : (
                  <span
                    className="rounded-sm px-1.5 py-0.5 text-[9.5px] font-700"
                    style={
                      t.status === "ganada"
                        ? { background: "rgba(47,214,165,0.12)", color: "#5ef2c4" }
                        : { background: "rgba(255,77,109,0.12)", color: "#ff7d95" }
                    }
                  >
                    {t.status === "ganada" ? "GANADA" : "PERDIDA"} · {r > 0 ? "+" : ""}{r.toFixed(1)}R
                  </span>
                )}
                <button onClick={() => remove(t.id)} className="text-dusk transition-colors hover:text-short-hi" title="Eliminar">
                  ✕
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
