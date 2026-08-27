import { useEffect, useMemo, useState } from "react";
import { fetchOrderBook, type OrderBook, type BookLevel } from "../lib/binance";
import { fmtUsd, fmtCompact } from "../lib/engine";

/* ============================================================
   Order Flow L2 — libro de órdenes en vivo de Binance.
   Formato clásico de dos columnas: COMPRAS (verde) a la izquierda,
   VENTAS (rojo) a la derecha, con el spread y el spot en el centro.
   Detecta muros de liquidez y el desequilibrio de presión.
   ============================================================ */

interface Wall {
  price: number;
  notional: number;
  side: "bid" | "ask";
  ratio: number;
}

function detectWalls(levels: BookLevel[], side: "bid" | "ask"): Wall[] {
  if (levels.length < 5) return [];
  const notionals = levels.map((l) => l.notional).sort((a, b) => a - b);
  const median = notionals[Math.floor(notionals.length / 2)] || 1;
  const walls: Wall[] = [];
  for (const l of levels) {
    const ratio = l.notional / median;
    if (ratio >= 3) walls.push({ price: l.price, notional: l.notional, side, ratio });
  }
  return walls.sort((a, b) => b.ratio - a.ratio).slice(0, 4);
}

const ROWS = 13;

export function OrderBookPanel({ spot }: { spot: number }) {
  const [book, setBook] = useState<OrderBook | null>(null);
  const [sim, setSim] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const b = await fetchOrderBook(100);
        if (alive && b.bids.length > 0) {
          setBook(b);
          setSim(false);
          setUpdatedAt(Date.now());
        }
      } catch {
        if (alive) setSim(true);
      }
    };
    void load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const stats = useMemo(() => {
    if (!book) return null;
    const bidTotal = book.bids.reduce((a, l) => a + l.notional, 0);
    const askTotal = book.asks.reduce((a, l) => a + l.notional, 0);
    const imbalance = bidTotal / (bidTotal + askTotal + 1e-9);
    const bidWalls = detectWalls(book.bids, "bid");
    const askWalls = detectWalls(book.asks, "ask");
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    const spread = bestAsk - bestBid;
    const spreadBps = bestBid > 0 ? (spread / bestBid) * 10_000 : 0;
    return { bidTotal, askTotal, imbalance, bidWalls, askWalls, bestBid, bestAsk, spreadBps };
  }, [book]);

  // columnas alineadas: bids (mejor abajo) y asks (mejor arriba), ambas junto al spread
  const cols = useMemo(() => {
    if (!book) return null;
    const bids = book.bids.slice(0, ROWS); // mejor primero → invertir para que quede abajo
    const asks = book.asks.slice(0, ROWS); // mejor primero → queda arriba
    const maxNotional = Math.max(...bids.map((l) => l.notional), ...asks.map((l) => l.notional), 1);
    // rellenar para que ambas columnas tengan la misma altura
    const padBids: (BookLevel | null)[] = [...bids];
    const padAsks: (BookLevel | null)[] = [...asks];
    while (padBids.length < ROWS) padBids.push(null);
    while (padAsks.length < ROWS) padAsks.push(null);
    return { bids: padBids.reverse(), asks: padAsks, maxNotional };
  }, [book]);

  const imb = stats?.imbalance ?? 0.5;
  const pressureWord = imb > 0.58 ? "PRESIÓN COMPRADORA" : imb < 0.42 ? "PRESIÓN VENDEDORA" : "PRESIÓN EQUILIBRADA";
  const imbColor = imb > 0.58 ? "#2fd6a5" : imb < 0.42 ? "#ff4d6d" : "#ffb547";

  const priceDecimals = (p: number) => (p >= 10000 ? 1 : p >= 1000 ? 2 : 3);

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">06b · order flow · profundidad del libro</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Dónde está la liquidez pasiva?
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El libro muestra la liquidez <b className="text-fog">pasiva</b> esperando: los{" "}
            <span className="text-long-hi">muros de compra</span> amortiguan caídas, los{" "}
            <span className="text-short-hi">muros de venta</span> frenan subidas. En vivo de Binance, cada 20s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] tracking-widest"
            style={{ color: sim ? "#ffb547" : "#2fd6a5", borderColor: sim ? "rgba(255,181,71,0.4)" : "rgba(47,214,165,0.4)", background: sim ? "rgba(255,181,71,0.07)" : "rgba(47,214,165,0.07)" }}
          >
            <span className="live-dot" style={{ background: "currentColor", color: "currentColor" }} />
            {sim ? "SIMULADO" : "EN VIVO"}
          </span>
          <span className="rounded-md border border-line bg-ink-950/60 px-2.5 py-1 font-mono text-[10px] tabular-nums text-mist">
            act. {updatedAt ? new Date(updatedAt).toLocaleTimeString("es-ES") : "—"}
          </span>
        </div>
      </div>

      {!book || !stats || !cols ? (
        <div className="mt-4 flex h-[320px] animate-pulse items-center justify-center rounded-lg border border-line/60 bg-ink-950/40 font-mono text-xs text-dusk">
          LEYENDO EL LIBRO DE ÓRDENES…
        </div>
      ) : (
        <>
          {/* ══ libro de dos columnas ══ */}
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="overflow-hidden rounded-lg border border-line/60 bg-ink-950/40">
              {/* cabeceras */}
              <div className="grid grid-cols-2 border-b border-line/60 bg-ink-900/50">
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="font-mono text-[10px] font-700 tracking-widest text-long-hi">◀ COMPRAS (BIDS)</span>
                  <span className="font-mono text-[10px] tabular-nums text-dusk">{fmtCompact(stats.bidTotal)}</span>
                </div>
                <div className="flex items-center justify-between border-l border-line/60 px-4 py-2">
                  <span className="font-mono text-[10px] tabular-nums text-dusk">{fmtCompact(stats.askTotal)}</span>
                  <span className="font-mono text-[10px] font-700 tracking-widest text-short-hi">VENTAS (ASKS) ▶</span>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_10px_1fr]">
                {/* columna COMPRAS */}
                <div className="flex flex-col">
                  {cols.bids.map((l, i) =>
                    l ? (
                      <BidRow key={`b${i}`} l={l} max={cols.maxNotional} walls={stats.bidWalls} decimals={priceDecimals(l.price)} />
                    ) : (
                      <div key={`b${i}`} className="h-[19px]" />
                    )
                  )}
                </div>
                {/* separador central con spread */}
                <div className="relative flex flex-col items-stretch justify-end border-x border-dashed border-line/60 bg-ink-900/30">
                  <div className="sticky bottom-0 flex flex-col items-center gap-0.5 bg-ink-900/80 py-2 backdrop-blur-sm">
                    <span className="font-mono text-[10px] font-700 tabular-nums tracking-wider text-warn">{fmtUsd(spot)}</span>
                    <span className="font-mono text-[8.5px] tabular-nums text-dusk">{stats.spreadBps.toFixed(1)} bps</span>
                  </div>
                </div>
                {/* columna VENTAS */}
                <div className="flex flex-col">
                  {cols.asks.map((l, i) =>
                    l ? (
                      <AskRow key={`a${i}`} l={l} max={cols.maxNotional} walls={stats.askWalls} decimals={priceDecimals(l.price)} />
                    ) : (
                      <div key={`a${i}`} className="h-[19px]" />
                    )
                  )}
                </div>
              </div>
              {/* pie del libro */}
              <div className="grid grid-cols-2 border-t border-line/60 bg-ink-900/40 px-4 py-1.5 font-mono text-[9px] tracking-wider text-dusk">
                <span>PROFUNDIDAD · BTC · PRECIO</span>
                <span className="text-right">PRECIO · BTC · PROFUNDIDAD</span>
              </div>
            </div>

            {/* columna lateral: desequilibrio + muros */}
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
                <div className="panel-tag">desequilibrio de liquidez</div>
                <div className="mt-2 font-mono text-2xl font-700 tabular-nums" style={{ color: imbColor }}>
                  {(imb * 100).toFixed(0)}% <span className="text-[12px] text-dusk">compra</span>
                </div>
                <div className="mt-2 flex h-3 overflow-hidden rounded-sm border border-line/60">
                  <div className="h-full transition-all duration-700" style={{ width: `${imb * 100}%`, background: "linear-gradient(90deg,#157a5c,#2fd6a5)" }} />
                  <div className="h-full transition-all duration-700" style={{ width: `${(1 - imb) * 100}%`, background: "linear-gradient(90deg,#ff4d6d,#8f1f36)" }} />
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-dusk">
                  <b style={{ color: imbColor }}>{pressureWord}.</b>{" "}
                  {imb > 0.58
                    ? "Más órdenes de compra esperando: soporte pasivo fuerte."
                    : imb < 0.42
                      ? "Más órdenes de venta esperando: resistencia pasiva fuerte."
                      : "Compra y venta parejas; sin ventaja pasiva clara."}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                  <div className="rounded-md bg-long/[0.08] px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-long-hi">bids</div>
                    <div className="font-700 text-fog">{fmtCompact(stats.bidTotal)}</div>
                  </div>
                  <div className="rounded-md bg-short/[0.08] px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-short-hi">asks</div>
                    <div className="font-700 text-fog">{fmtCompact(stats.askTotal)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
                <div className="panel-tag">muros detectados (≥3× la mediana)</div>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {[...stats.askWalls, ...stats.bidWalls].length === 0 && (
                    <p className="font-mono text-[10.5px] text-dusk">Sin muros destacados en los 100 niveles.</p>
                  )}
                  {[...stats.askWalls, ...stats.bidWalls]
                    .sort((a, b) => b.notional - a.notional)
                    .slice(0, 5)
                    .map((w, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-line/50 bg-ink-950/40 px-2.5 py-1.5 font-mono text-[11px] tabular-nums">
                        <span className={w.side === "bid" ? "text-long-hi" : "text-short-hi"}>{w.side === "bid" ? "COMPRA" : "VENTA"}</span>
                        <span className="text-fog">{fmtUsd(w.price)}</span>
                        <span className="text-dusk">{fmtCompact(w.notional)} · {w.ratio.toFixed(1)}×</span>
                      </div>
                    ))}
                </div>
                <p className="mt-2.5 text-[11px] leading-snug text-dusk">
                  Un muro de <b className="text-long-hi">compra</b> bajo el precio es un colchón; uno de{" "}
                  <b className="text-short-hi">venta</b> arriba, un techo. Si el precio los absorbe con volumen, suelen
                  romperse y acelerar el movimiento.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* fila de compra: [barra | BTC | precio], barra anclada a la derecha (junto al spread) */
function BidRow({ l, max, walls, decimals }: { l: BookLevel; max: number; walls: Wall[]; decimals: number }) {
  const w = (l.notional / max) * 100;
  const isWall = walls.some((wl) => Math.abs(wl.price - l.price) < 1e-6);
  return (
    <div className="relative flex h-[19px] items-center justify-end gap-2 overflow-hidden pl-2 pr-0 transition-colors hover:bg-long/[0.05]">
      <div
        className="absolute inset-y-0 right-0 rounded-l-[2px]"
        style={{
          width: `${Math.max(w, 1.5)}%`,
          background: isWall
            ? "linear-gradient(270deg,#2fd6a5,#157a5c)"
            : "linear-gradient(270deg,rgba(47,214,165,0.55),rgba(47,214,165,0.08))",
          boxShadow: isWall ? "0 0 12px -2px rgba(47,214,165,0.9)" : "none",
        }}
      />
      <span className="relative font-mono text-[9.5px] tabular-nums text-fog/80">{l.qty.toFixed(3)}</span>
      <span className={`relative w-[76px] shrink-0 text-right font-mono text-[10.5px] font-600 tabular-nums ${isWall ? "text-long-hi" : "text-long"}`}>
        {l.price.toFixed(decimals)}
      </span>
      {isWall && (
        <span className="relative rounded-sm bg-long/25 px-1 font-mono text-[7.5px] font-700 text-long-hi">MURO</span>
      )}
    </div>
  );
}

/* fila de venta: [precio | BTC | barra], barra anclada a la izquierda (junto al spread) */
function AskRow({ l, max, walls, decimals }: { l: BookLevel; max: number; walls: Wall[]; decimals: number }) {
  const w = (l.notional / max) * 100;
  const isWall = walls.some((wl) => Math.abs(wl.price - l.price) < 1e-6);
  return (
    <div className="relative flex h-[19px] items-center gap-2 overflow-hidden pl-0 pr-2 transition-colors hover:bg-short/[0.05]">
      <div
        className="absolute inset-y-0 left-0 rounded-r-[2px]"
        style={{
          width: `${Math.max(w, 1.5)}%`,
          background: isWall
            ? "linear-gradient(90deg,#ff4d6d,#c22745)"
            : "linear-gradient(90deg,rgba(255,77,109,0.55),rgba(255,77,109,0.08))",
          boxShadow: isWall ? "0 0 12px -2px rgba(255,77,109,0.9)" : "none",
        }}
      />
      {isWall && (
        <span className="relative rounded-sm bg-short/25 px-1 font-mono text-[7.5px] font-700 text-short-hi">MURO</span>
      )}
      <span className={`relative w-[76px] shrink-0 font-mono text-[10.5px] font-600 tabular-nums ${isWall ? "text-short-hi" : "text-short"}`}>
        {l.price.toFixed(decimals)}
      </span>
      <span className="relative font-mono text-[9.5px] tabular-nums text-fog/80">{l.qty.toFixed(3)}</span>
    </div>
  );
}
