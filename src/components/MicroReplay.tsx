import { useEffect, useMemo, useRef, useState } from "react";
import type { L2Frame } from "../lib/l2";
import type { LiqEvent } from "../lib/engine";
import { fmtCompact } from "../lib/engine";
import { getFutTrades, type TradeEvent } from "../lib/streams";

/* ============================================================
   Replay de microestructura: rebobina la historia REAL capturada
   (libro L2 + trades agresivos + liquidaciones) en una sola
   línea de tiempo. No hay pasado inventado: solo existe lo que
   se capturó desde que abriste la app.
   ============================================================ */

const H = 360;
const PAD_L = 64; // eje de precios
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 26; // eje de tiempo

const BID = "47,214,165";
const ASK = "255,77,109";

const fmtP = (v: number) => (v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(1));
const fmtT = (t: number) =>
  new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function MicroReplay({ frames, liq }: { frames: L2Frame[]; liq: LiqEvent[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [playT, setPlayT] = useState(0); // playhead en ms (0 = aún no definido)
  const [, forceTick] = useState(0);

  const trades = getFutTrades();

  // ventana temporal = desde el primer frame hasta el último evento conocido
  const win = useMemo(() => {
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const f of frames) {
      t0 = Math.min(t0, f.t);
      t1 = Math.max(t1, f.t);
    }
    if (trades.length) {
      t0 = Math.min(t0, trades[0].t);
      t1 = Math.max(t1, trades[trades.length - 1].t);
    }
    for (const l of liq) {
      t0 = Math.min(t0, l.time);
      t1 = Math.max(t1, l.time);
    }
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
    return { t0, t1 };
  }, [frames, trades.length, liq]);

  const hasData = win !== null && frames.length >= 2;

  // inicializa el playhead al final cuando hay datos
  useEffect(() => {
    if (win && playT === 0) setPlayT(win.t1);
  }, [win, playT]);

  // motor de reproducción (rAF) — el updater debe ser puro: solo actualiza el playhead
  useEffect(() => {
    if (!playing || !win) return;
    lastTsRef.current = performance.now();
    const step = (ts: number) => {
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      setPlayT((prev) => Math.min(prev + dt * speed, win.t1));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, win]);

  // detiene la reproducción al llegar al final (fuera del updater, que debe ser puro)
  useEffect(() => {
    if (playing && win && playT >= win.t1) setPlaying(false);
  }, [playing, playT, win]);

  // refresca la vista periódicamente para captar eventos nuevos en vivo
  useEffect(() => {
    const id = setInterval(() => forceTick((x) => x + 1), 1200);
    return () => clearInterval(id);
  }, []);

  // dibujo
  useEffect(() => {
    const cv = cvRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap || !win || !hasData) return;
    const W = wrap.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { t0, t1 } = win;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const xOf = (t: number) => PAD_L + ((t - t0) / (t1 - t0)) * plotW;

    // rango de precios: de trades + frames (con colchón)
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of frames) {
      const bb = f.bids[0]?.p ?? 0;
      const ba = f.asks[0]?.p ?? 0;
      if (bb > 0) lo = Math.min(lo, bb);
      if (ba > 0) hi = Math.max(hi, ba);
    }
    for (const tr of trades) {
      lo = Math.min(lo, tr.p);
      hi = Math.max(hi, tr.p);
    }
    for (const l of liq) {
      lo = Math.min(lo, l.price);
      hi = Math.max(hi, l.price);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      lo = 1;
      hi = 2;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const yOf = (p: number) => PAD_T + ((hi - p) / (hi - lo)) * plotH;

    // rejilla de precios
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#5d7099";
    ctx.textAlign = "right";
    ctx.strokeStyle = "rgba(93,112,153,0.1)";
    for (let k = 0; k <= 5; k++) {
      const p = hi - ((hi - lo) * k) / 5;
      const y = yOf(p);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();
      ctx.fillText(fmtP(p), PAD_L - 7, y + 3);
    }

    // eje de tiempo
    ctx.textAlign = "center";
    for (let k = 0; k <= 4; k++) {
      const t = t0 + ((t1 - t0) * k) / 4;
      ctx.fillText(fmtT(t), xOf(t), H - 8);
    }

    // línea de precio (mids de frames)
    ctx.beginPath();
    frames.forEach((f, i) => {
      const bb = f.bids[0]?.p ?? 0;
      const ba = f.asks[0]?.p ?? bb;
      const m = bb + (ba - bb) / 2;
      const x = xOf(f.t);
      const y = yOf(m);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(233,241,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // trades agresivos (puntos)
    for (const tr of trades) {
      if (tr.t < t0 || tr.t > t1) continue;
      const x = xOf(tr.t);
      const y = yOf(tr.p);
      const r = 1.2 + Math.min(2.4, Math.log10(1 + tr.n / 5000));
      ctx.fillStyle = tr.sell ? `rgba(${ASK},0.55)` : `rgba(${BID},0.55)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // liquidaciones (rombos)
    for (const l of liq) {
      if (l.time < t0 || l.time > t1) continue;
      const x = xOf(l.time);
      const y = yOf(l.price);
      const c = l.side === "long" ? ASK : BID; // long liquidado = rojo (bajista)
      const s = 3.5 + Math.min(4, Math.log10(1 + l.notional / 10000));
      ctx.fillStyle = `rgba(${c},0.9)`;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fill();
    }

    // huella del libro en el playhead (bandas de profundidad hacia la derecha)
    let frame: L2Frame | null = null;
    for (const f of frames) {
      if (f.t <= playT) frame = f;
      else break;
    }
    const px = xOf(Math.min(Math.max(playT, t0), t1));
    if (frame) {
      const maxNot = Math.max(
        1,
        ...frame.bids.slice(0, 10).map((l) => l.p * l.q),
        ...frame.asks.slice(0, 10).map((l) => l.p * l.q)
      );
      const bandW = W - PAD_R - px;
      const draw = (levels: { p: number; q: number }[], rgb: string) => {
        for (const l of levels.slice(0, 10)) {
          const y = yOf(l.p);
          const w = 14 + (Math.log10(1 + l.p * l.q) / Math.log10(1 + maxNot)) * (bandW - 14);
          ctx.fillStyle = `rgba(${rgb},0.16)`;
          ctx.fillRect(px, y - 2.5, w, 5);
          ctx.fillStyle = `rgba(${rgb},0.55)`;
          ctx.fillRect(px, y - 2.5, 2.5, 5);
        }
      };
      draw(frame.bids, BID);
      draw(frame.asks, ASK);
    }

    // línea de playhead
    ctx.strokeStyle = "#ffb547";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px, PAD_T);
    ctx.lineTo(px, H - PAD_B);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [win, hasData, frames, trades.length, liq, playT]);

  if (!hasData || !win) {
    return (
      <div className="p-5">
        <div className="panel-tag">06e · replay de microestructura</div>
        <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">Rebobina la cinta</h2>
        <div className="mt-4 flex h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line/70 bg-ink-950/40">
          <span className="live-dot h-3 w-3" style={{ background: "#ff4d6d", color: "#ff4d6d" }} />
          <div className="font-mono text-[13px] tracking-widest text-mist">GRABANDO MICROESTRUCTURA…</div>
          <div className="max-w-md px-6 text-center font-mono text-[10.5px] leading-relaxed text-dusk">
            El replay necesita libro + trades + liquidaciones capturados en vivo. Se llena solo en unos segundos; no
            existe microestructura retroactiva.
          </div>
        </div>
      </div>
    );
  }

  const pct = ((Math.min(Math.max(playT, win.t0), win.t1) - win.t0) / (win.t1 - win.t0)) * 100;
  const atEnd = playT >= win.t1 - 50;

  // estadísticas en el playhead
  const frame = frames.filter((f) => f.t <= playT).pop() ?? null;
  const cvdUpTo = trades.filter((t) => t.t <= playT).reduce((a, t) => a + (t.sell ? -t.n : t.n), 0);
  const liqsUpTo = liq.filter((l) => l.time <= playT);
  const liqLong = liqsUpTo.filter((l) => l.side === "long").reduce((a, l) => a + l.notional, 0);
  const liqShort = liqsUpTo.filter((l) => l.side === "short").reduce((a, l) => a + l.notional, 0);

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">06e · replay de microestructura</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Rebobina la cinta real
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            Libro, trades agresivos y liquidaciones capturados desde que abriste la app, en una sola línea de tiempo.
            Mueve el scrubber o dale al play para revivir cómo se construyó cada movimiento.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-md border border-short/40 bg-short/[0.07] px-2.5 py-1 font-mono text-[10px] font-700 tracking-widest text-short-hi">
          <span className="live-dot" style={{ background: "currentColor", color: "currentColor" }} />
          {atEnd ? "EN VIVO" : "REPLAY"}
        </span>
      </div>

      {/* controles */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            if (atEnd && !playing) setPlayT(win.t0);
            setPlaying((p) => !p);
          }}
          className="rounded-md border border-warn/60 bg-warn/10 px-4 py-1.5 font-mono text-[12px] font-700 tracking-widest text-warn transition-all hover:bg-warn/20 hover:shadow-[0_0_16px_-4px_rgba(255,181,71,0.6)]"
        >
          {playing ? "❚❚ PAUSA" : "▶ PLAY"}
        </button>
        {[1, 2, 4, 8].map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`chip ${speed === s ? "on" : ""}`}
            style={speed === s ? { borderColor: "rgba(255,181,71,0.6)", color: "#ffb547", background: "rgba(255,181,71,0.08)" } : undefined}
          >
            {s}×
          </button>
        ))}
        <button onClick={() => { setPlaying(false); setPlayT(win.t1); }} className="chip ml-auto">
          ⏭ AL PRESENTE
        </button>
      </div>

      {/* canvas */}
      <div ref={wrapRef} className="relative mt-3 overflow-hidden rounded-lg border border-line/60 bg-ink-950/60">
        <canvas ref={cvRef} />
      </div>

      {/* scrubber */}
      <div className="mt-3 flex items-center gap-3">
        <span className="w-[70px] shrink-0 text-left font-mono text-[10px] tabular-nums text-dusk">{fmtT(win.t0)}</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pct * 10)}
          onChange={(e) => {
            setPlaying(false);
            setPlayT(win.t0 + (Number(e.target.value) / 1000) * (win.t1 - win.t0));
          }}
          className="h-1.5 w-full cursor-pointer accent-[#ffb547]"
        />
        <span className="w-[70px] shrink-0 text-right font-mono text-[10px] tabular-nums text-dusk">{fmtT(win.t1)}</span>
      </div>

      {/* lectura en el playhead */}
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Stat label="instante" value={fmtT(playT)} />
        <Stat label="mid" value={frame ? fmtP((frame.bids[0]?.p ?? 0) + ((frame.asks[0]?.p ?? frame.bids[0]?.p ?? 0) - (frame.bids[0]?.p ?? 0)) / 2) : "—"} />
        <Stat label="spread" value={frame ? fmtP((frame.asks[0]?.p ?? 0) - (frame.bids[0]?.p ?? 0)) : "—"} />
        <Stat
          label="CVD acumulado"
          value={fmtCompact(cvdUpTo)}
          color={cvdUpTo >= 0 ? "#5ef2c4" : "#ff7d95"}
        />
        <Stat
          label="liq longs/shorts"
          value={`${fmtCompact(liqLong)} / ${fmtCompact(liqShort)}`}
          color="#93a5c8"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] text-dusk">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: `rgb(${BID})` }} /> compra agresiva / bid</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: `rgb(${ASK})` }} /> venta agresiva / ask</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rotate-45" style={{ background: "#ff7d95" }} /> liquidación</span>
        <span className="ml-auto">las bandas del libro son la profundidad en el instante del playhead</span>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-line/50 bg-ink-950/40 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-dusk">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] font-700 tabular-nums" style={{ color: color ?? "#e9f1ff" }}>
        {value}
      </div>
    </div>
  );
}
