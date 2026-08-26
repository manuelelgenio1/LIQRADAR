import type { Verdict } from "../lib/engine";
import { fmtCompact } from "../lib/engine";

function CvdSpark({ series, positive }: { series: number[]; positive: boolean }) {
  if (series.length < 2) return <div className="mt-2 h-9" />;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const W = 220;
  const H = 34;
  const pts = series
    .map((v, i) => `${((i / (series.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - min) / span) * (H - 6)).toFixed(1)}`)
    .join(" ");
  const color = positive ? "#2fd6a5" : "#ff4d6d";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity="0.09" />
      <line x1="0" y1={H - 3 - ((0 - min) / span) * (H - 6)} x2={W} y2={H - 3 - ((0 - min) / span) * (H - 6)} stroke="#2b426e" strokeWidth="0.8" strokeDasharray="3 3" />
    </svg>
  );
}

interface Props {
  v: Verdict;
  longPool: number;
  shortPool: number;
  fundingRate: number;
  globalRatio: number;
  topRatio: number;
  oi: number;
  oiChange24h: number;
  change24h: number;
  cvdPct: number;
  cvdNet: number;
  cvdSeries: number[];
}

function DualBar({ left, right, leftLabel, rightLabel }: { left: number; right: number; leftLabel: string; rightLabel: string }) {
  const l = (left / (left + right || 1)) * 100;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-sm bg-ink-900">
        <div className="h-full bg-long transition-all duration-700" style={{ width: `${l}%` }} />
        <div className="h-full bg-short transition-all duration-700" style={{ width: `${100 - l}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums">
        <span className="text-long-hi">{leftLabel}</span>
        <span className="text-short-hi">{rightLabel}</span>
      </div>
    </div>
  );
}

export function AccumulationPanel(p: Props) {
  const { v } = p;
  const crowdedLong = p.fundingRate > 0 && p.globalRatio > 1;
  const crowdedShort = p.fundingRate < 0 && p.globalRatio < 1;

  let readout: string;
  if (crowdedLong) {
    readout =
      "El mercado está amontonado en LONG: funding positivo y mayoría de cuentas compradas. Esa multitud necesita que el precio no caiga… y su liquidez descansa debajo del spot. Es el escenario clásico de caza de longs.";
  } else if (crowdedShort) {
    readout =
      "El mercado está amontonado en SHORT: funding negativo y mayoría de cuentas vendidas. Esa multitud necesita que el precio no suba… y su liquidez descansa encima del spot. Es el escenario clásico de short squeeze.";
  } else {
    readout =
      "La multitud está dividida: funding y posicionamiento no apuntan a un solo lado. Los pools de liquidación del mapa mandan: el precio tenderá hacia el cluster más grande hasta encontrar resistencia real.";
  }

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">04 · posicionamiento</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Quién está amontonado?
          </h2>
        </div>
        <div
          className="rounded-md border px-3 py-1.5 font-mono text-[11px] font-700 tracking-widest"
          style={{
            color: v.direction === "up" ? "#2fd6a5" : v.direction === "down" ? "#ff4d6d" : "#ffb547",
            borderColor: "rgba(27,44,74,0.8)",
            background: "rgba(5,11,22,0.6)",
          }}
        >
          LECTURA: {v.direction === "up" ? "COMBUSTIBLE ALCISTA" : v.direction === "down" ? "COMBUSTIBLE BAJISTA" : "MERCADO DIVIDIDO"}
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-mist">{readout}</p>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* funding */}
        <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="panel-tag">funding perpetuo</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1v14M4.5 4.5 8 1l3.5 3.5M4.5 11.5 8 15l3.5-3.5" stroke={p.fundingRate >= 0 ? "#2fd6a5" : "#ff4d6d"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className={`mt-2 font-mono text-xl font-700 tabular-nums ${p.fundingRate >= 0 ? "text-long" : "text-short"}`}>
            {(p.fundingRate * 100).toFixed(4)}%
          </div>
          <p className="mt-1 text-[11px] leading-snug text-dusk">
            {p.fundingRate >= 0 ? "Longs pagan a shorts → exceso de compradores" : "Shorts pagan a longs → exceso de vendedores"}
          </p>
        </div>

        {/* cuentas */}
        <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <span className="panel-tag">cuentas retail L/S</span>
          <div className="mt-2 font-mono text-xl font-700 tabular-nums text-fog">
            {p.globalRatio.toFixed(2)}
            <span className="ml-2 text-[11px] font-500 text-dusk">× long/short</span>
          </div>
          <div className="mt-2">
            <DualBar
              left={p.globalRatio}
              right={1}
              leftLabel={`LONG ${((p.globalRatio / (p.globalRatio + 1)) * 100).toFixed(0)}%`}
              rightLabel={`SHORT ${((1 / (p.globalRatio + 1)) * 100).toFixed(0)}%`}
            />
          </div>
        </div>

        {/* top traders */}
        <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <span className="panel-tag">posiciones top traders</span>
          <div className="mt-2 font-mono text-xl font-700 tabular-nums text-fog">
            {p.topRatio.toFixed(2)}
            <span className="ml-2 text-[11px] font-500 text-dusk">× long/short</span>
          </div>
          <div className="mt-2">
            <DualBar
              left={p.topRatio}
              right={1}
              leftLabel={`LONG ${((p.topRatio / (p.topRatio + 1)) * 100).toFixed(0)}%`}
              rightLabel={`SHORT ${((1 / (p.topRatio + 1)) * 100).toFixed(0)}%`}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-dusk">
            {p.topRatio < 1 ? "Las ballenas están vendidas: cuidado con el squeeze." : "Las ballenas están compradas: buscan liquidez abajo."}
          </p>
        </div>

        {/* OI */}
        <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <span className="panel-tag">interés abierto</span>
          <div className="mt-2 font-mono text-xl font-700 tabular-nums text-fog">
            {p.oi > 0 ? p.oi.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}
            <span className="ml-2 text-[11px] font-500 text-dusk">BTC</span>
          </div>
          <div className="mt-2 flex items-center gap-2 font-mono text-[11px] tabular-nums">
            <span className={`rounded-sm px-1.5 py-0.5 ${p.oiChange24h >= 0 ? "bg-long/10 text-long-hi" : "bg-short/10 text-short-hi"}`}>
              OI {p.oiChange24h >= 0 ? "+" : ""}{p.oiChange24h.toFixed(1)}%
            </span>
            <span className={`rounded-sm px-1.5 py-0.5 ${p.change24h >= 0 ? "bg-long/10 text-long-hi" : "bg-short/10 text-short-hi"}`}>
              PX {p.change24h >= 0 ? "+" : ""}{p.change24h.toFixed(1)}%
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-dusk">
            {p.oiChange24h > 1
              ? "Apalancamiento creciendo: más gasolina para el sweep."
              : p.oiChange24h < -1
                ? "Desapalancamiento: el movimiento ya se descargó en parte."
                : "Apalancamiento estable, sin carga extra de combustible."}
          </p>
        </div>

        {/* CVD */}
        <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <span className="panel-tag">delta de takers (CVD)</span>
          <div className={`mt-2 font-mono text-xl font-700 tabular-nums ${p.cvdPct >= 0 ? "text-long" : "text-short"}`}>
            {p.cvdPct >= 0 ? "+" : ""}
            {(p.cvdPct * 100).toFixed(1)}%
            <span className="ml-2 text-[11px] font-500 text-dusk">del volumen</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] tabular-nums text-dusk">{fmtCompact(p.cvdNet)} USDT netos</div>
          <CvdSpark series={p.cvdSeries} positive={p.cvdPct >= 0} />
          <p className="mt-1.5 text-[11px] leading-snug text-dusk">
            {p.cvdPct > 0.02
              ? "Compra agresiva dominante: se apilan longs a mercado."
              : p.cvdPct < -0.02
                ? "Venta agresiva dominante: se apilan shorts a mercado."
                : "Flujo comprador/vendedor equilibrado en la ventana."}
          </p>
        </div>
      </div>

      {/* pools */}
      <div className="mt-3 rounded-lg border border-line/70 bg-ink-950/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="panel-tag">pools de liquidación estimados en el mapa</span>
          <span className="font-mono text-[11px] tabular-nums text-dusk">
            ratio {p.shortPool >= p.longPool ? (p.shortPool / Math.max(p.longPool, 1)).toFixed(2) + "× arriba" : (p.longPool / Math.max(p.shortPool, 1)).toFixed(2) + "× abajo"}
          </span>
        </div>
        <div className="mt-2.5">
          <DualBar
            left={p.longPool}
            right={p.shortPool}
            leftLabel={`LONGS (abajo) ${fmtCompact(p.longPool)}`}
            rightLabel={`SHORTS (arriba) ${fmtCompact(p.shortPool)}`}
          />
        </div>
      </div>
    </div>
  );
}
