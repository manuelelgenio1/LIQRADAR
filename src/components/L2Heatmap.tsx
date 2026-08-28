import { useEffect, useRef, useState } from "react";
import type { L2Frame } from "../lib/l2";

/* ============================================================
   Heatmap L2 histórico — la profundidad REAL capturada desde que
   abriste la app, trazada en tiempo × precio. No existe L2
   retroactivo público: la historia empieza aquí y se declara así.
   Verde = bids (liquidez compradora) · Rojo = asks (vendedora) ·
   Línea ámbar = precio mid.
   ============================================================ */

const ROWS = 56;
const AX_W = 60; // eje de precios
const AX_H = 20; // eje de tiempo
const BID = [47, 214, 165];
const ASK = [255, 77, 109];

const fmtK = (v: number) =>
  v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0);

function useTick(ms: number): number {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return Date.now();
}

export function L2Heatmap({ frames, historySec }: { frames: L2Frame[]; historySec: number }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  useTick(1000); // el contador de captura late

  const n = frames.length;
  const ready = n >= 2;

  useEffect(() => {
    const cv = cvRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap || !ready) return;
    const W = wrap.clientWidth;
    const H = 340;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const plotX = AX_W;
    const plotW = W - AX_W - 10;
    const plotY = 6;
    const plotH = H - AX_H - 10;

    let lo = Infinity;
    let hi = -Infinity;
    let maxNot = 1;
    for (const f of frames) {
      const bb = f.bids[0]?.p ?? 0;
      const ba = f.asks[0]?.p ?? 0;
      if (bb > 0) lo = Math.min(lo, bb);
      if (ba > 0) hi = Math.max(hi, ba);
      for (const l of f.bids) maxNot = Math.max(maxNot, l.p * l.q);
      for (const l of f.asks) maxNot = Math.max(maxNot, l.p * l.q);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return;
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;

    const yOf = (p: number) => plotY + ((hi - p) / (hi - lo)) * plotH;
    const xOf = (i: number) => plotX + (i / (n - 1)) * plotW;
    const colW = Math.max(1.4, Math.min(13, plotW / (n - 1)));
    const rowH = plotH / ROWS;
    const snap = (p: number) => Math.round(((hi - p) / (hi - lo)) * (ROWS - 1));

    // fondo sutil por zonas (bid/ask respecto al mid de cada frame)
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      const bb = f.bids[0]?.p ?? 0;
      const ba = f.asks[0]?.p ?? bb;
      const m = bb + (ba - bb) / 2;
      const yMid = yOf(m);
      const x = xOf(i);
      ctx.fillStyle = "rgba(47,214,165,0.03)";
      ctx.fillRect(x - colW / 2, yMid, colW, plotY + plotH - yMid);
      ctx.fillStyle = "rgba(255,77,109,0.03)";
      ctx.fillRect(x - colW / 2, plotY, colW, yMid - plotY);
    }

    // celdas de profundidad
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      const x = xOf(i);
      const cell = (p: number, notional: number, rgb: number[]) => {
        const r = snap(p);
        const y = plotY + r * rowH;
        const a = 0.14 + 0.82 * Math.min(1, Math.log10(1 + notional) / Math.log10(1 + maxNot));
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
        ctx.fillRect(x - colW / 2, y, colW, rowH - 0.6);
      };
      for (const l of f.bids) cell(l.p, l.p * l.q, BID);
      for (const l of f.asks) cell(l.p, l.p * l.q, ASK);
    }

    // línea de mid
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      const bb = f.bids[0]?.p ?? 0;
      const ba = f.asks[0]?.p ?? bb;
      const m = bb + (ba - bb) / 2;
      const x = xOf(i);
      const y = yOf(m);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#ffb547";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = "rgba(255,181,71,0.8)";
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ejes
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#5d7099";
    ctx.textAlign = "right";
    for (let k = 0; k <= 4; k++) {
      const p = hi - ((hi - lo) * k) / 4;
      ctx.fillText(fmtK(p), AX_W - 7, yOf(p) + 3);
    }
    ctx.textAlign = "center";
    const t0 = frames[0].t;
    const t1 = frames[n - 1].t;
    const tLabel = (t: number) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    ctx.fillText(tLabel(t0), plotX + 26, H - 6);
    ctx.fillText(tLabel((t0 + t1) / 2), plotX + plotW / 2, H - 6);
    ctx.fillText(tLabel(t1), plotX + plotW - 26, H - 6);
  }, [frames, ready, n]);

  const info = hover && ready ? frames[Math.min(n - 1, Math.max(0, hover.i))] : null;

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">06d · heatmap L2 · profundidad capturada</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            La historia real del libro
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            Profundidad <b className="text-fog">observada</b> desde que abriste la app:{" "}
            <span className="text-long-hi">verde = liquidez compradora</span>,{" "}
            <span className="text-short-hi">rojo = vendedora</span>, línea ámbar = precio. Ningún exchange publica L2
            retroactivo — esta historia empieza aquí y crece en vivo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-md border border-short/40 bg-short/[0.07] px-2.5 py-1 font-mono text-[10px] font-700 tracking-widest text-short-hi">
            <span className="live-dot" style={{ background: "currentColor", color: "currentColor" }} />
            REC
          </span>
          <span className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-mist">
            {Math.floor(historySec / 60)}:{String(Math.floor(historySec % 60)).padStart(2, "0")} capturados · {n} frames
          </span>
        </div>
      </div>

      {!ready ? (
        <div className="mt-4 flex h-[300px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line/70 bg-ink-950/40">
          <span className="live-dot h-3 w-3" style={{ background: "#ff4d6d", color: "#ff4d6d" }} />
          <div className="font-mono text-[13px] tracking-widest text-mist">CAPTURANDO EL LIBRO…</div>
          <div className="font-mono text-[10.5px] tabular-nums text-dusk">
            {n} frame{n === 1 ? "" : "s"} · la historia empieza ahora mismo, sin pasado inventado
          </div>
        </div>
      ) : (
        <div
          ref={wrapRef}
          className="relative mt-4 cursor-crosshair overflow-hidden rounded-lg border border-line/60 bg-ink-950/60"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            const plotX = AX_W;
            const plotW = r.width - AX_W - 10;
            const i = Math.round(((x - plotX) / plotW) * (n - 1));
            if (i >= 0 && i < n) setHover({ i, x, y: e.clientY - r.top });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <canvas ref={cvRef} />
          {info && (
            <div
              className="pointer-events-none absolute z-10 w-[210px] rounded-md border border-line bg-ink-900/95 px-3 py-2 font-mono text-[10px] tabular-nums shadow-xl"
              style={{
                left: Math.min(Math.max(hover!.x - 105, 6), (wrapRef.current?.clientWidth ?? 300) - 216),
                top: 8,
              }}
            >
              <div className="text-dusk">
                {new Date(info.t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-long-hi">bid {fmtK(info.bids[0]?.p ?? 0)}</span>
                <span className="text-short-hi">ask {fmtK(info.asks[0]?.p ?? 0)}</span>
              </div>
              <div className="mt-0.5 flex justify-between text-mist">
                <span>{fmtK(info.bidTotal)} $</span>
                <span>{fmtK(info.askTotal)} $</span>
              </div>
              <div className="mt-0.5 text-dusk">
                desbalance{" "}
                <span className={info.bidTotal >= info.askTotal ? "text-long-hi" : "text-short-hi"}>
                  {((info.bidTotal / (info.bidTotal + info.askTotal + 1e-9)) * 100).toFixed(0)}%
                </span>{" "}
                comprador
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] text-dusk">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3 rounded-[2px]" style={{ background: "rgba(47,214,165,0.8)" }} /> bids (soporte)
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-3 rounded-[2px]" style={{ background: "rgba(255,77,109,0.8)" }} /> asks (resistencia)
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-[2px] w-4 rounded-full bg-warn" /> mid
        </span>
        <span className="ml-auto">la intensidad de cada celda escala con el nocional del nivel</span>
      </div>
    </div>
  );
}
