import { useEffect, useMemo, useState } from "react";
import {
  fetchFundingHistoryBinance,
  fetchFundingHistoryBybit,
  fetchFundingHistoryOkx,
  type FundingPoint,
} from "../lib/exchanges";
import {
  buildFundingHeat,
  fmtRate,
  payer,
  rateColor,
  simFunding,
  type FundingCell,
} from "../lib/fundingHeat";

/* ============================================================
   Heatmap de funding por exchange (Binance · OKX · Bybit).
   Cada celda = un settlement (8h). Verde = shorts pagan,
   rojo = longs pagan. Revela dónde se apila el apalancamiento.
   ============================================================ */

interface Hover {
  row: number;
  col: number;
  cell: FundingCell;
  label: string;
}

const COLS = 24; // últimos 8 días (settlements cada 8h)

export function FundingHeatmap() {
  const [heat, setHeat] = useState<ReturnType<typeof buildFundingHeat> | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let sim = false;
      const series: Record<"binance" | "okx" | "bybit", FundingPoint[]> = {
        binance: [],
        okx: [],
        bybit: [],
      };
      const [b, o, y] = await Promise.allSettled([
        fetchFundingHistoryBinance(60),
        fetchFundingHistoryOkx(60),
        fetchFundingHistoryBybit(60),
      ]);
      if (b.status === "fulfilled") series.binance = b.value;
      if (o.status === "fulfilled") series.okx = o.value;
      if (y.status === "fulfilled") series.bybit = y.value;

      const haveReal = series.binance.length > 0 || series.okx.length > 0 || series.bybit.length > 0;
      if (!haveReal) {
        sim = true;
        series.binance = simFunding(COLS, 0);
        series.okx = simFunding(COLS, 2);
        series.bybit = simFunding(COLS, 4);
      } else {
        // si algún exchange falló pero otros no, rellena el hueco con simulador
        if (series.binance.length === 0) series.binance = simFunding(COLS, 0);
        if (series.okx.length === 0) series.okx = simFunding(COLS, 2);
        if (series.bybit.length === 0) series.bybit = simFunding(COLS, 4);
      }

      if (alive) {
        setHeat(buildFundingHeat(series, sim, COLS));
        setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const timeLabels = useMemo(() => {
    if (!heat || heat.cols === 0) return [];
    const first = heat.rows.find((r) => r.cells.length > 0)?.cells ?? [];
    return first.map((c, i) => {
      const d = new Date(c.time);
      return {
        i,
        label:
          d.getDate() === new Date().getDate()
            ? d.toLocaleTimeString("es-ES", { hour: "2-digit" })
            : d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
      };
    });
  }, [heat]);

  if (loading) {
    return (
      <div className="p-5">
        <Header sim={false} loading />
        <div className="mt-4 flex h-40 animate-pulse items-center justify-center rounded-lg border border-line/50 font-mono text-xs text-dusk">
          CARGANDO HISTÓRICO DE FUNDING…
        </div>
      </div>
    );
  }

  if (!heat || heat.cols === 0) {
    return (
      <div className="p-5">
        <Header sim loading />
        <div className="mt-4 flex h-40 items-center justify-center rounded-lg border border-line/50 font-mono text-xs text-dusk">
          SIN DATOS DE FUNDING DISPONIBLES
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      <Header sim={heat.sim} />

      {/* gradiente de referencia */}
      <div className="mt-4 flex items-center gap-3">
        <span className="panel-tag">shorts pagan</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: "linear-gradient(90deg,#2fd6a5,#3a3f52 48%,#ff4d6d)" }}
        />
        <span className="panel-tag">longs pagan</span>
      </div>

      {/* heatmap */}
      <div className="relative mt-3">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `72px repeat(${heat.cols}, 1fr)` }}
        >
          {heat.rows.map((row, ri) => (
            <FragmentRow
              key={row.exchange}
              row={row}
              ri={ri}
              heat={heat}
              onHover={(col, cell) => setHover({ row: ri, col, cell, label: row.label })}
            />
          ))}

          {/* labels de tiempo */}
          <div />
          {timeLabels.map((t) => (
            <div
              key={t.i}
              className="pt-1 text-center font-mono text-[9px] tabular-nums text-dusk"
              style={{ visibility: t.i % 4 === 0 ? "visible" : "hidden" }}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border border-line bg-ink-900/95 px-3 py-2 font-mono text-[11px] shadow-xl"
            style={{
              left: `${((hover.col + 1.5) / (heat.cols + 1)) * 100}%`,
              top: hover.row * 44 - 8,
              transform: "translate(-50%,-100%)",
            }}
          >
            <div className="font-700 text-fog">
              {hover.label} ·{" "}
              {new Date(hover.cell.time).toLocaleString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="mt-0.5 tabular-nums">
              <span
                style={{
                  color: hover.cell.rate >= 0.0001 ? "#ff7d95" : "#5ef2c4",
                }}
              >
                {fmtRate(hover.cell.rate)}
              </span>{" "}
              <span className="text-dusk">· {payer(hover.cell.rate)}</span>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 border-t border-line/40 pt-2 font-mono text-[10.5px] leading-relaxed text-dusk">
        Cada celda es un settlement de funding (cada 8h). <b className="text-short-hi">Rojo intenso = longs pagan caro</b>{" "}
        (multitud alcista apilada, combustible bajista) · <b className="text-long-hi">verde = shorts pagan</b> (combustible
        alcista). Compara filas: si un exchange está mucho más rojo que los demás, ahí se concentra el apalancamiento.
      </p>
    </div>
  );
}

function Header({ sim, loading = false }: { sim: boolean; loading?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="panel-tag">06c · heatmap de funding · por exchange</div>
        <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
          ¿Dónde se apila el apalancamiento?
        </h2>
      </div>
      <span
        className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] tabular-nums"
        style={{ color: loading ? "#93a5c8" : sim ? "#ffb547" : "#2fd6a5" }}
      >
        {loading ? "cargando…" : sim ? "DATOS SIMULADOS" : "DATOS EN VIVO"}
      </span>
    </div>
  );
}

function FragmentRow({
  row,
  ri,
  heat,
  onHover,
}: {
  row: { exchange: string; label: string; color: string; cells: FundingCell[]; ok: boolean };
  ri: number;
  heat: { maxAbs: number };
  onHover: (col: number, cell: FundingCell) => void;
}) {
  return (
    <>
      {/* label de exchange */}
      <div className="flex items-center font-mono text-[10px] font-700 tracking-widest" style={{ color: row.color }}>
        {row.label}
      </div>
      {row.cells.map((cell, ci) => (
        <div
          key={ci}
          onMouseEnter={() => onHover(ci, cell)}
          className="h-9 cursor-crosshair rounded-[3px] transition-transform duration-150 hover:scale-y-110"
          style={{
            background: rateColor(cell.rate, heat.maxAbs),
            boxShadow: Math.abs(cell.rate - 0.0001) / heat.maxAbs > 0.7 ? `0 0 12px -3px ${rateColor(cell.rate, heat.maxAbs)}` : "none",
          }}
        />
      ))}
    </>
  );
}
