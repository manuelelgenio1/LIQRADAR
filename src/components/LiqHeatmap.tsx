import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "../lib/engine";
import { fmtUsd } from "../lib/engine";
import { buildHeatmap, heatColor, type HeatmapData } from "../lib/heatmap";

interface Props {
  candles: Candle[];
  leverages: number[];
  lookback: number;
  label: string;
}

const AXIS_W = 58;
const AXIS_H = 20;

interface Hover {
  x: number;
  y: number;
  price: number;
  time: number;
  intensity: number;
  below: boolean;
}

export function LiqHeatmap({ candles, leverages, lookback, label }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);
  const geomRef = useRef({ plotX: 0, plotY: 0, plotW: 0, plotH: 0, dpr: 1 });
  const [hover, setHover] = useState<Hover | null>(null);

  const data: HeatmapData | null = useMemo(
    () => (candles.length > 4 ? buildHeatmap(candles, leverages, 64, lookback) : null),
    [candles, leverages, lookback]
  );

  /* ---------- dibujo base ---------- */
  useEffect(() => {
    const wrap = wrapRef.current;
    const base = baseRef.current;
    if (!wrap || !base || !data) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      base.width = W * dpr;
      base.height = H * dpr;
      base.style.width = `${W}px`;
      base.style.height = `${H}px`;
      const ctx = base.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // dimensiona también el canvas de interacción
      const over = overRef.current;
      if (over) {
        over.width = W * dpr;
        over.height = H * dpr;
        over.style.width = `${W}px`;
        over.style.height = `${H}px`;
        over.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const plotX = 0;
      const plotY = 0;
      const plotW = W - AXIS_W;
      const plotH = H - AXIS_H;
      geomRef.current = { plotX, plotY, plotW, plotH, dpr };

      const { cols, bins, matrix, closes, priceMin, priceMax } = data;
      const cw = plotW / cols;
      const chh = plotH / bins;
      const priceRange = priceMax - priceMin;

      // celdas
      for (let i = 0; i < cols; i++) {
        const close = closes[i];
        for (let b = 0; b < bins; b++) {
          const t = matrix[i * bins + b];
          const binPrice = priceMax - (b + 0.5) * (priceRange / bins);
          ctx.fillStyle = heatColor(t, binPrice < close);
          ctx.fillRect(plotX + i * cw, plotY + b * chh, cw + 0.5, chh + 0.5);
        }
      }

      // línea de precio
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const y = plotY + ((priceMax - closes[i]) / priceRange) * plotH;
        const x = plotX + (i + 0.5) * cw;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#ffb547";
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(255,181,71,0.5)";
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // marcador del precio actual
      const lastX = plotX + (cols - 0.5) * cw;
      const lastY = plotY + ((priceMax - closes[cols - 1]) / priceRange) * plotH;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd382";
      ctx.shadowColor = "rgba(255,181,71,0.9)";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // eje de precio (derecha)
      ctx.fillStyle = "#5d7099";
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.textBaseline = "middle";
      for (let k = 0; k <= 4; k++) {
        const p = priceMax - (k / 4) * priceRange;
        const y = plotY + (k / 4) * plotH;
        ctx.fillText(short(p), plotX + plotW + 6, y);
        ctx.strokeStyle = "rgba(93,112,153,0.14)";
        ctx.beginPath();
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotW, y);
        ctx.stroke();
      }

      // eje de tiempo (abajo)
      const spanMs = (data.times[cols - 1] - data.times[0]) * 1000;
      ctx.textAlign = "center";
      for (let k = 0; k < 5; k++) {
        const i = Math.round((k / 4) * (cols - 1));
        const x = plotX + (i + 0.5) * cw;
        ctx.fillText(fmtTick(data.times[i] * 1000, spanMs), x, plotY + plotH + 11);
      }
      ctx.textAlign = "left";
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [data]);

  /* ---------- interacción ---------- */
  const onMove = (e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap || !data) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { plotX, plotY, plotW, plotH } = geomRef.current;
    if (x < plotX || x > plotX + plotW || y < plotY || y > plotY + plotH) {
      clearOver();
      setHover(null);
      return;
    }
    const { cols, bins, matrix, closes, priceMin, priceMax } = data;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((x - plotX) / plotW) * cols)));
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(((y - plotY) / plotH) * bins)));
    const price = priceMax - (bin + 0.5) * ((priceMax - priceMin) / bins);
    const intensity = matrix[col * bins + bin];
    const below = price < closes[col];

    // crosshair en overlay (tamaño ya fijado en el dibujo base)
    const over = overRef.current;
    if (over) {
      const octx = over.getContext("2d");
      if (octx) {
        octx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
        octx.strokeStyle = "rgba(233,241,255,0.35)";
        octx.setLineDash([4, 4]);
        octx.beginPath();
        octx.moveTo(x, plotY);
        octx.lineTo(x, plotY + plotH);
        octx.moveTo(plotX, y);
        octx.lineTo(plotX + plotW, y);
        octx.stroke();
      }
    }
    setHover({ x, y, price, time: data.times[col] * 1000, intensity, below });
  };

  const clearOver = () => {
    const over = overRef.current;
    const wrap = wrapRef.current;
    if (over && wrap) {
      const octx = over.getContext("2d");
      if (octx) octx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
    }
  };

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">M6 · heatmap de liquidación · {label}</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Mapa de calor en el tiempo
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            Como el heatmap de Coinglass: cada columna es el mapa de liquidación estimado en ese momento.
            Las bandas <span className="text-long-hi">verdes</span> (debajo del precio) son combustible de longs;
            las <span className="text-short-hi">rojas</span> (encima), de shorts. Las zonas brillantes son{" "}
            <b className="text-fog">imanes de liquidez</b> hacia los que el precio tiende a viajar.
          </p>
        </div>
        <div className="flex gap-x-5 font-mono text-[10.5px] text-dusk">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-long" />liq longs</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-short" />liq shorts</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-warn" />precio</span>
        </div>
      </div>

      <div
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={() => {
          clearOver();
          setHover(null);
        }}
        className="relative mt-4 h-[320px] w-full cursor-crosshair overflow-hidden rounded-md border border-line/60 bg-ink-950/70 sm:h-[380px]"
      >
        <canvas ref={baseRef} className="absolute inset-0" />
        <canvas ref={overRef} className="pointer-events-none absolute inset-0" />

        {hover && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border border-line bg-ink-900/95 px-3 py-2 font-mono text-[10.5px] tabular-nums shadow-xl"
            style={{
              left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 300) - 190),
              top: Math.max(8, hover.y - 54),
            }}
          >
            <div className="text-dusk">
              {new Date(hover.time).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-fog">{fmtUsd(hover.price)}</div>
            <div className={hover.below ? "text-long-hi" : "text-short-hi"}>
              {hover.below ? "LIQ LONGS" : "LIQ SHORTS"} · {(hover.intensity * 100).toFixed(0)}% intensidad
            </div>
          </div>
        )}
      </div>

      {/* escala de intensidad + guía de lectura */}
      <div className="mt-3 flex flex-col gap-2 border-t border-line/50 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 font-mono text-[10px] text-dusk">
          <span className="panel-tag">intensidad</span>
          <span>baja</span>
          <div className="flex h-2.5 w-32 overflow-hidden rounded-sm border border-line/60">
            <div className="h-full flex-1" style={{ background: "linear-gradient(90deg,rgba(147,165,200,0.08),rgba(147,165,200,0.5))" }} />
          </div>
          <div className="flex h-2.5 w-32 overflow-hidden rounded-sm border border-line/60">
            <div className="h-full flex-1" style={{ background: "linear-gradient(90deg,rgba(47,214,165,0.15),#2fd6a5)" }} />
          </div>
          <div className="flex h-2.5 w-32 overflow-hidden rounded-sm border border-line/60">
            <div className="h-full flex-1" style={{ background: "linear-gradient(90deg,rgba(255,77,109,0.15),#ff4d6d)" }} />
          </div>
          <span>alta</span>
        </div>
        <p className="max-w-md text-[11px] leading-snug text-dusk">
          <b className="text-fog">Cómo leerlo:</b> sigue una banda brillante en el tiempo. Si se mantiene cerca del
          precio y este se acerca, es un imán activo; si se aleja, el combustible se desplazó.
        </p>
      </div>
    </div>
  );
}

function short(p: number): string {
  if (p >= 1000) return (p / 1000).toFixed(p >= 100000 ? 0 : 1) + "k";
  return p.toFixed(0);
}

function fmtTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs > 2 * 86400_000) {
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  }
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
