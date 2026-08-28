import { useEffect, useState } from "react";
import {
  fetchAccountRatioSeries,
  fetchFundingSeries,
  fetchOIHistory,
  fetchTakerSeries,
  type SeriesPoint,
} from "../lib/binance";
import { fmtCompact } from "../lib/engine";

/* ============================================================
   Pulso del mercado: históricos reales de posicionamiento
   (funding, OI, takers y cuentas) — las gráficas firma de los
   agregadores profesionales, con datos directos de Binance.
   ============================================================ */

interface TileDef {
  id: string;
  label: string;
  window: string;
  format: (v: number) => string;
  neutral: number; // valor "equilibrado" para colorear
  aboveIsLong: boolean; // > neutral = multitud long (rojo de contrarian)
  note: (v: number, neutral: number) => string;
  load: () => Promise<SeriesPoint[]>;
}

const TILES: TileDef[] = [
  {
    id: "funding",
    label: "Funding rate",
    window: "30 días · cada 8h",
    format: (v) => (v * 100).toFixed(4) + "%",
    neutral: 0.0001,
    aboveIsLong: true,
    note: (v) =>
      v > 0.0002
        ? "longs pagando caro: multitud alcista apilada"
        : v < 0
          ? "shorts pagando: multitud bajista apilada"
          : "funding neutro: sin multitud definida",
    load: async () => (await fetchFundingSeries(90)).map((p) => ({ ...p })),
  },
  {
    id: "oi",
    label: "Interés abierto",
    window: "7 días · 1h",
    format: (v) => (v / 1000).toFixed(1) + "k BTC",
    neutral: 0,
    aboveIsLong: false,
    note: (v, _n) => `OI actual ${fmtCompact(v * 60000)} nocional aprox.`,
    load: async () => (await fetchOIHistory("1h", 168)).map((p) => ({ time: p.time, value: p.oi })),
  },
  {
    id: "taker",
    label: "Volumen taker compra/venta",
    window: "7 días · 1h",
    format: (v) => v.toFixed(3) + "×",
    neutral: 1,
    aboveIsLong: true,
    note: (v) =>
      v > 1.05
        ? "dominan las compras agresivas (multitud long)"
        : v < 0.95
          ? "dominan las ventas agresivas (multitud short)"
          : "flujo comprador/vendedor equilibrado",
    load: () => fetchTakerSeries("1h", 168),
  },
  {
    id: "ratio",
    label: "Cuentas long/short (retail)",
    window: "7 días · 1h",
    format: (v) => v.toFixed(3) + "×",
    neutral: 1,
    aboveIsLong: true,
    note: (v) =>
      v > 1.2
        ? "retail muy inclinado a long: combustible bajista"
        : v < 0.85
          ? "retail muy inclinado a short: combustible alcista"
          : "retail repartido entre ambos bandos",
    load: () => fetchAccountRatioSeries("1h", 168),
  },
];

function Spark({ data, color, refLine, format }: { data: SeriesPoint[]; color: string; refLine: number | null; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return null;

  const W = 300;
  const H = 92;
  const PAD = 6;
  const vals = data.map((d) => d.value);
  const lo = Math.min(...vals, refLine ?? Infinity);
  const hi = Math.max(...vals, refLine ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `M${x(0)},${H - PAD} L${pts.replace(/ /g, " L")} L${x(data.length - 1)},${H - PAD} Z`;
  const gi = `g-${color.replace("#", "")}`;

  const idx = hover === null ? null : Math.min(data.length - 1, Math.max(0, hover));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.round(((px - PAD) / (W - PAD * 2)) * (data.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gi} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {refLine !== null && refLine >= lo && refLine <= hi && (
          <line x1={PAD} x2={W - PAD} y1={y(refLine)} y2={y(refLine)} stroke="#5d7099" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.7" />
        )}
        <path d={area} fill={`url(#${gi})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx={x(data.length - 1)} cy={y(vals[vals.length - 1])} r="2.6" fill={color}>
          <animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite" />
        </circle>
        {idx !== null && (
          <g>
            <line x1={x(idx)} x2={x(idx)} y1={PAD} y2={H - PAD} stroke="rgba(233,241,255,0.35)" strokeWidth="0.8" strokeDasharray="3 3" />
            <circle cx={x(idx)} cy={y(vals[idx])} r="3.2" fill="#e9f1ff" stroke={color} strokeWidth="1.4" />
          </g>
        )}
      </svg>
      {idx !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-ink-900/95 px-2 py-1 font-mono text-[9.5px] tabular-nums shadow-lg"
          style={{ left: `${Math.min(85, Math.max(15, (idx / (data.length - 1)) * 100))}%` }}
        >
          <span className="text-dusk">
            {new Date(data[idx].time * 1000).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>{" "}
          <span style={{ color }}>{format(data[idx].value)}</span>
        </div>
      )}
    </div>
  );
}

interface TileState {
  data: SeriesPoint[];
  noData: boolean; // REAL ONLY: fuente ausente → se declara, no se simula
}

export function MarketPulsePanel() {
  const [tiles, setTiles] = useState<Record<string, TileState>>({});

  useEffect(() => {
    let alive = true;
    TILES.forEach((t) => {
      t.load()
        .then((d) => {
          // REAL ONLY: serie válida o SIN DATOS — jamás una serie inventada
          if (alive) setTiles((s) => ({ ...s, [t.id]: { data: d.length > 1 ? d : [], noData: d.length <= 1 } }));
        })
        .catch(() => {
          if (alive) setTiles((s) => ({ ...s, [t.id]: { data: [], noData: true } }));
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">05 · pulso del mercado</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Históricos de posicionamiento
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            Las mismas series que usan los agregadores profesionales — funding, interés abierto, takers y cuentas —
            leídas <b className="text-fog">directamente de Binance</b> y trazadas en el tiempo. Pasa el cursor sobre cada
            gráfica para inspeccionar el histórico.
          </p>
        </div>
        <span className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] text-mist">
          datos: futures/data · fapi/v1
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TILES.map((t) => {
          const st = tiles[t.id];
          if (!st) {
            return (
              <div key={t.id} className="flex h-[150px] animate-pulse items-center justify-center rounded-lg border border-line/60 bg-ink-950/40 font-mono text-[10px] text-dusk">
                cargando {t.label.toLowerCase()}…
              </div>
            );
          }
          if (st.noData || st.data.length < 2) {
            return (
              <div key={t.id} className="flex h-[150px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-warn/30 bg-ink-950/40 px-4 text-center">
                <span className="font-mono text-[11px] font-700 tracking-[0.2em] text-warn">SIN DATOS</span>
                <span className="font-mono text-[9.5px] leading-snug text-dusk">
                  {t.label}: la fuente no está disponible en tu red. REAL ONLY — no se fabrica histórico.
                </span>
              </div>
            );
          }
          const vals = st.data.map((d) => d.value);
          const now = vals[vals.length - 1];
          const start = vals[0];
          const delta = ((now - start) / Math.abs(start || 1)) * 100;
          const crowdedLong = t.aboveIsLong ? now > t.neutral : delta > 1.5;
          const crowdedShort = t.aboveIsLong ? now < t.neutral : delta < -1.5;
          const color = t.id === "oi" ? "#3fb6ff" : crowdedLong ? "#ff4d6d" : crowdedShort ? "#2fd6a5" : "#93a5c8";
          const refLine = t.id === "funding" ? 0.0001 : t.id === "oi" ? null : t.neutral;

          return (
            <div key={t.id} className="group rounded-lg border border-line/60 bg-ink-950/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-600 text-fog">{t.label}</div>
                  <div className="font-mono text-[9.5px] text-dusk">{t.window}</div>
                </div>
                <span
                  className={`rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-700 tabular-nums ${
                    delta >= 0 ? "bg-long/10 text-long-hi" : "bg-short/10 text-short-hi"
                  }`}
                >
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 font-mono text-xl font-700 tabular-nums" style={{ color }}>
                {t.format(now)}
              </div>
              <Spark data={st.data} color={color} refLine={refLine} format={t.format} />
              <div className="mt-1 flex justify-between font-mono text-[9px] tabular-nums text-dusk">
                <span>mín {t.format(Math.min(...vals))}</span>
                <span>máx {t.format(Math.max(...vals))}</span>
              </div>
              <p className="mt-1.5 border-t border-line/40 pt-1.5 text-[10.5px] leading-snug text-dusk">{t.note(now, t.neutral)}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-4 font-mono text-[10.5px] text-dusk">
        Lectura contrarian: cuando una serie se aleja de su zona neutra (línea discontinua), la multitud está de un solo
        lado y su combustible de liquidación se apila en el lado contrario — el mismo principio que usa el motor del radar.
      </p>
    </div>
  );
}
