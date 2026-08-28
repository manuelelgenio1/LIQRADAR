import { useCallback, useEffect, useRef, useState } from "react";
import {
  binanceQuote,
  EXCHANGE_COLOR,
  EXCHANGE_LABEL,
  fetchBybit,
  fetchOkx,
  type ExchangeQuote,
} from "../lib/exchanges";
import { fmtCompact, fmtUsd } from "../lib/engine";

/* ============================================================
   Radar multi-exchange: compara BTC en Binance, OKX y Bybit.
   Precio, funding y OI en vivo + señales de divergencia.
   ============================================================ */

interface Props {
  spot: number;
  change24h: number;
  fundingRate: number;
  oiBtc: number;
}

type Remote = { quote: ExchangeQuote | null; error: boolean; loading: boolean };

export function ExchangeRadarPanel({ spot, change24h, fundingRate, oiBtc }: Props) {
  const [okx, setOkx] = useState<Remote>({ quote: null, error: false, loading: true });
  const [bybit, setBybit] = useState<Remote>({ quote: null, error: false, loading: true });
  const [updatedAt, setUpdatedAt] = useState(0);
  const [ago, setAgo] = useState(0);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setOkx((s) => ({ ...s, loading: true }));
    setBybit((s) => ({ ...s, loading: true }));
    const [o, b] = await Promise.allSettled([fetchOkx(), fetchBybit()]);
    if (!aliveRef.current) return;
    setOkx(
      o.status === "fulfilled"
        ? { quote: o.value, error: false, loading: false }
        : { quote: null, error: true, loading: false }
    );
    setBybit(
      b.status === "fulfilled"
        ? { quote: b.value, error: false, loading: false }
        : { quote: null, error: true, loading: false }
    );
    setUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setAgo(updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : 0), 1000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const quotes: ExchangeQuote[] = [
    binanceQuote(spot, change24h, fundingRate, oiBtc),
    ...(okx.quote ? [okx.quote] : []),
    ...(bybit.quote ? [bybit.quote] : []),
  ];

  const prices = quotes.map((q) => q.price);
  const spreadPct = prices.length > 1 ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100 : 0;
  const cheapest = quotes.length > 1 ? quotes.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const fundings = quotes.map((q) => q.fundingRate);
  const fundingGapBps = fundings.length > 1 ? (Math.max(...fundings) - Math.min(...fundings)) * 1e4 : 0;
  const crowded = quotes.length > 1 ? quotes.reduce((a, b) => (b.fundingRate > a.fundingRate ? b : a)) : null;
  const totalOi = quotes.reduce((a, q) => a + q.oiUsdt, 0);

  const remotes: { name: string; st: Remote }[] = [
    { name: "OKX", st: okx },
    { name: "Bybit", st: bybit },
  ];

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">06 · radar multi-exchange</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            BTC en tres exchanges a la vez
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El mercado es global: compara precio, funding e interés abierto entre <b className="text-fog">Binance, OKX y Bybit</b> en
            tiempo real. Las divergencias entre exchanges delatan dónde se está apilando la multitud.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-dusk">
            {updatedAt ? `hace ${ago}s` : "conectando…"}
          </span>
          <button className="chip" onClick={() => void refresh()} disabled={okx.loading || bybit.loading}>
            ⟳ refrescar
          </button>
        </div>
      </div>

      {/* tabla comparativa */}
      <div className="mt-4 overflow-hidden rounded-lg border border-line/70 bg-ink-950/50">
        <div className="grid grid-cols-[86px_1fr_1fr_1fr_1fr] gap-px bg-line/40 font-mono text-[11px]">
          <div className="bg-ink-900/80 px-3 py-2 text-dusk">EXCHANGE</div>
          <div className="bg-ink-900/80 px-3 py-2 text-right text-dusk">PRECIO</div>
          <div className="bg-ink-900/80 px-3 py-2 text-right text-dusk">24H</div>
          <div className="bg-ink-900/80 px-3 py-2 text-right text-dusk">FUNDING</div>
          <div className="bg-ink-900/80 px-3 py-2 text-right text-dusk">OI</div>

          {(["binance", "okx", "bybit"] as const).map((ex) => {
            const q = quotes.find((x) => x.exchange === ex);
            const remote = ex === "okx" ? okx : ex === "bybit" ? bybit : null;
            const unreachable = remote !== null && remote.error;
            const loading = remote !== null && remote.loading && !remote.quote;
            return (
              <Row
                key={ex}
                label={EXCHANGE_LABEL[ex]}
                color={EXCHANGE_COLOR[ex]}
                q={q ?? null}
                loading={loading}
                unreachable={unreachable}
                isCheapest={cheapest?.exchange === ex && spreadPct > 0.02}
              />
            );
          })}
        </div>
      </div>

      {/* señales entre exchanges */}
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <Signal
          label="spread de precio"
          value={quotes.length > 1 ? `${spreadPct.toFixed(3)}%` : "—"}
          tone={spreadPct > 0.15 ? "warn" : "ok"}
          detail={
            quotes.length > 1
              ? spreadPct > 0.15
                ? `divergencia activa: BTC más barato en ${cheapest ? EXCHANGE_LABEL[cheapest.exchange] : "—"}`
                : "precios alineados entre exchanges (arbitraje eficiente)"
              : "esperando a los demás exchanges…"
          }
        />
        <Signal
          label="brecha de funding"
          value={quotes.length > 1 ? `${fundingGapBps.toFixed(2)} bps` : "—"}
          tone={fundingGapBps > 0.5 ? "warn" : "ok"}
          detail={
            quotes.length > 1
              ? fundingGapBps > 0.5
                ? `longs más caros en ${crowded ? EXCHANGE_LABEL[crowded.exchange] : "—"}: allí se apila la multitud`
                : "funding homogéneo: sin sesgo entre exchanges"
              : "esperando a los demás exchanges…"
          }
        />
        <Signal
          label="OI agregado (3 exchanges)"
          value={totalOi > 0 ? fmtCompact(totalOi) : "—"}
          tone="ok"
          detail={totalOi > 0 ? "interés abierto combinado: el tamaño total del casino" : "sin datos todavía"}
        />
      </div>

      {remotes.some((r) => r.st.error) && (
        <p className="mt-2.5 font-mono text-[10.5px] text-warn">
          ▸ {remotes.filter((r) => r.st.error).map((r) => r.name).join(" y ")} sin alcanzar desde tu red — el radar sigue
          operativo con el resto de fuentes.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  color,
  q,
  loading,
  unreachable,
  isCheapest,
}: {
  label: string;
  color: string;
  q: ExchangeQuote | null;
  loading: boolean;
  unreachable: boolean;
  isCheapest: boolean;
}) {
  const cell = "bg-ink-900/60 px-3 py-2.5 tabular-nums";
  if (loading) {
    return (
      <>
        <div className={`${cell} flex items-center gap-2 font-700 tracking-wider`} style={{ color }}>
          <span className="live-dot" style={{ background: color, color }} /> {label}
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${cell} animate-pulse text-right text-dusk`}>···</div>
        ))}
      </>
    );
  }
  if (unreachable || !q) {
    return (
      <>
        <div className={`${cell} flex items-center gap-2 font-700 tracking-wider`} style={{ color }}>
          <span className="live-dot" style={{ background: "#5d7099", color: "#5d7099" }} /> {label}
        </div>
        <div className={`${cell} col-span-4 text-left text-dusk`}>sin alcanzar desde tu red</div>
      </>
    );
  }
  const fColor = q.fundingRate > 0.00005 ? "#ff7d95" : q.fundingRate < -0.00005 ? "#5ef2c4" : "#93a5c8";
  return (
    <>
      <div className={`${cell} flex items-center gap-2 font-700 tracking-wider`} style={{ color }}>
        <span className="live-dot" style={{ background: color, color }} />
        {label}
        {isCheapest && (
          <span className="rounded-sm bg-long/15 px-1 py-[1px] text-[8.5px] font-700 text-long-hi">BARATO</span>
        )}
      </div>
      <div className={`${cell} text-right text-fog`}>{fmtUsd(q.price, 1)}</div>
      <div className={`${cell} text-right ${q.change24h >= 0 ? "text-long-hi" : "text-short-hi"}`}>
        {q.change24h >= 0 ? "+" : ""}
        {q.change24h.toFixed(2)}%
      </div>
      <div className={`${cell} text-right`} style={{ color: fColor }}>
        {(q.fundingRate * 100).toFixed(4)}%
      </div>
      <div className={`${cell} text-right text-mist`}>{q.oiUsdt > 0 ? fmtCompact(q.oiUsdt) : "—"}</div>
    </>
  );
}

function Signal({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warn";
}) {
  const c = tone === "warn" ? "#ffb547" : "#2fd6a5";
  return (
    <div className="rounded-md border border-line/60 bg-ink-950/40 px-3.5 py-2.5 transition-colors hover:border-line">
      <div className="flex items-baseline justify-between gap-2">
        <span className="panel-tag">{label}</span>
        <span className="font-mono text-[15px] font-700 tabular-nums" style={{ color: c }}>
          {value}
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-snug text-dusk">{detail}</div>
    </div>
  );
}
