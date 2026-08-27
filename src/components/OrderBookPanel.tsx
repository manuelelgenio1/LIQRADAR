import { useEffect, useMemo, useState } from "react";
import { fetchOrderBook, type OrderBook, type BookLevel } from "../lib/binance";
import { fmtUsd, fmtCompact } from "../lib/engine";

/* ============================================================
   Order Flow L2: profundidad del libro de órdenes de Binance.
   Visualiza muros de liquidez pasiva (compra/venta), detecta
   "walls" inusuales y el desequilibrio de presión comprador/vendedor.
   ============================================================ */

interface Wall {
  price: number;
  notional: number;
  side: "bid" | "ask";
  ratio: number; // veces la mediana
}

function detectWalls(levels: BookLevel[], side: "bid" | "ask"): Wall[] {
  if (levels.length < 5) return [];
  const notionals = levels.map((l) => l.notional).sort((a, b) => a - b);
  const median = notionals[Math.floor(notionals.length / 2)] || 1;
  const walls: Wall[] = [];
  for (const l of levels) {
    const ratio = l.notional / median;
    if (ratio >= 3) {
      walls.push({ price: l.price, notional: l.notional, side, ratio });
    }
  }
  return walls.sort((a, b) => b.ratio - a.ratio).slice(0, 4);
}

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
    const imbalance = bidTotal / (bidTotal + askTotal + 1e-9); // 0..1 (>0.5 = presión compradora)
    const bidWalls = detectWalls(book.bids, "bid");
    const askWalls = detectWalls(book.asks, "ask");
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    const spread = bestAsk - bestBid;
    const spreadBps = bestBid > 0 ? (spread / bestBid) * 10_000 : 0;
    return { bidTotal, askTotal, imbalance, bidWalls, askWalls, bestBid, bestAsk, spreadBps };
  }, [book]);

  // datos para la escalera de profundidad (20 niveles por lado)
  const ladder = useMemo(() => {
    if (!book) return null;
    const N = 20;
    const bids = book.bids.slice(0, N);
    const asks = book.asks.slice(0, N).reverse(); // de más lejano a más cercano
    const maxNotional = Math.max(
      ...bids.map((l) => l.notional),
      ...asks.map((l) => l.notional),
      1
    );
    return { bids, asks, maxNotional };
  }, [book]);

  const imb = stats?.imbalance ?? 0.5;
  const pressureWord =
    imb > 0.58 ? "PRESIÓN COMPRADORA" : imb < 0.42 ? "PRESIÓN VENDEDORA" : "PRESIÓN EQUILIBRADA";
  const imbColor = imb > 0.58 ? "#2fd6a5" : imb < 0.42 ? "#ff4d6d" : "#ffb547";

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">06b · order flow · profundidad del libro</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            ¿Dónde está la liquidez pasiva?
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El libro de órdenes muestra la liquidez <b className="text-fog">pasiva</b> esperando: los{" "}
            <span className="text-long-hi">muros de compra</span> (bids) amortiguan caídas, los{" "}
            <span className="text-short-hi">muros de venta</span> (asks) frenan subidas. Datos en vivo de Binance,
            refrescados cada 20s{sim ? " · SIMULADO" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums">
          <span className="text-dusk">
            spread <b className="text-fog">{stats ? stats.spreadBps.toFixed(1) + " bps" : "—"}</b>
          </span>
          <span className="text-dusk">
            act. <b className="text-fog">{updatedAt ? new Date(updatedAt).toLocaleTimeString("es-ES") : "—"}</b>
          </span>
        </div>
      </div>

      {!book || !stats || !ladder ? (
        <div className="mt-4 flex h-[300px] animate-pulse items-center justify-center rounded-lg border border-line/60 bg-ink-950/40 font-mono text-xs text-dusk">
          LEYENDO EL LIBRO DE ÓRDENES…
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
          {/* escalera de profundidad */}
          <div>
            <div className="flex flex-col gap-[3px]">
              {/* asks (rojo) — de más lejano a más cercano */}
              {ladder.asks.map((l, i) => {
                const w = (l.notional / ladder.maxNotional) * 100;
                const isWall = stats.askWalls.some((wl) => Math.abs(wl.price - l.price) < 1e-6);
                return (
                  <div key={`a${i}`} className="group relative flex h-[15px] items-center gap-2">
                    <span className="w-[86px] shrink-0 text-right font-mono text-[10px] tabular-nums text-mist">
                      {fmtUsd(l.price)}
                    </span>
                    <div className="relative h-full flex-1 rounded-[2px] bg-ink-950/70">
                      <div
                        className="absolute inset-y-0 left-0 rounded-[2px]"
                        style={{
                          width: `${Math.max(w, 1.5)}%`,
                          background: isWall
                            ? "linear-gradient(90deg,#ff4d6d,#c22745)"
                            : "linear-gradient(90deg,rgba(255,77,109,0.65),rgba(255,77,109,0.15))",
                          boxShadow: isWall ? "0 0 12px -2px rgba(255,77,109,0.9)" : "none",
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-between px-2">
                        <span className="font-mono text-[9px] tabular-nums text-fog/90">
                          {l.qty.toFixed(3)} BTC
                        </span>
                        {isWall && (
                          <span className="rounded-sm bg-short/20 px-1 font-mono text-[8px] font-700 text-short-hi">
                            MURO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* línea de spread / spot */}
              <div className="my-1.5 flex items-center gap-2">
                <span className="w-[86px] shrink-0" />
                <div className="relative flex h-[26px] flex-1 items-center justify-center overflow-visible rounded-sm border-y border-dashed border-warn/50 bg-warn/[0.06]">
                  <span className="font-mono text-[11px] font-700 tabular-nums tracking-widest text-warn">
                    SPOT {fmtUsd(spot)}
                  </span>
                </div>
              </div>

              {/* bids (verde) — de más cercano a más lejano */}
              {ladder.bids.map((l, i) => {
                const w = (l.notional / ladder.maxNotional) * 100;
                const isWall = stats.bidWalls.some((wl) => Math.abs(wl.price - l.price) < 1e-6);
                return (
                  <div key={`b${i}`} className="group relative flex h-[15px] items-center gap-2">
                    <span className="w-[86px] shrink-0 text-right font-mono text-[10px] tabular-nums text-mist">
                      {fmtUsd(l.price)}
                    </span>
                    <div className="relative h-full flex-1 rounded-[2px] bg-ink-950/70">
                      <div
                        className="absolute inset-y-0 left-0 rounded-[2px]"
                        style={{
                          width: `${Math.max(w, 1.5)}%`,
                          background: isWall
                            ? "linear-gradient(90deg,#2fd6a5,#157a5c)"
                            : "linear-gradient(90deg,rgba(47,214,165,0.65),rgba(47,214,165,0.15))",
                          boxShadow: isWall ? "0 0 12px -2px rgba(47,214,165,0.9)" : "none",
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-between px-2">
                        <span className="font-mono text-[9px] tabular-nums text-fog/90">
                          {l.qty.toFixed(3)} BTC
                        </span>
                        {isWall && (
                          <span className="rounded-sm bg-long/20 px-1 font-mono text-[8px] font-700 text-long-hi">
                            MURO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* panel lateral: desequilibrio + muros */}
          <div className="flex flex-col gap-4">
            {/* desequilibrio */}
            <div className="rounded-lg border border-line/70 bg-ink-950/50 p-4">
              <div className="panel-tag">desequilibrio de liquidez</div>
              <div className="mt-2 font-mono text-2xl font-700 tabular-nums" style={{ color: imbColor }}>
                {(imb * 100).toFixed(0)}% <span className="text-[12px] text-dusk">compra</span>
              </div>
              <div className="mt-2 flex h-3 overflow-hidden rounded-sm border border-line/60">
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: `${imb * 100}%`, background: "linear-gradient(90deg,#157a5c,#2fd6a5)" }}
                />
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: `${(1 - imb) * 100}%`, background: "linear-gradient(90deg,#ff4d6d,#8f1f36)" }}
                />
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-dusk">
                <b style={{ color: imbColor }}>{pressureWord}.</b>{" "}
                {imb > 0.58
                  ? "Hay más órdenes de compra esperando: el soporte pasivo es fuerte."
                  : imb < 0.42
                    ? "Hay más órdenes de venta esperando: la resistencia pasiva es fuerte."
                    : "Compra y venta están parejas; sin ventaja pasiva clara."}
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

            {/* muros detectados */}
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
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md border border-line/50 bg-ink-950/40 px-2.5 py-1.5 font-mono text-[11px] tabular-nums"
                    >
                      <span className={w.side === "bid" ? "text-long-hi" : "text-short-hi"}>
                        {w.side === "bid" ? "COMPRA" : "VENTA"}
                      </span>
                      <span className="text-fog">{fmtUsd(w.price)}</span>
                      <span className="text-dusk">
                        {fmtCompact(w.notional)} · {w.ratio.toFixed(1)}×
                      </span>
                    </div>
                  ))}
              </div>
              <p className="mt-2.5 text-[11px] leading-snug text-dusk">
                Un muro de <b className="text-long-hi">compra</b> bajo el precio actúa como colchón; un muro de{" "}
                <b className="text-short-hi">venta</b> arriba, como techo. Si el precio los absorbe con volumen, suelen
                romperse y acelerar el movimiento.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
