import { useMemo, useState } from "react";
import { fmtUsd } from "../lib/engine";

/* ============================================================
   Gestión de riesgo: dimensiona la posición a partir del imán
   (objetivo) y del nivel de invalidación que da el radar, para
   que el riesgo por operación sea siempre el que tú decidas.
   ============================================================ */

interface Props {
  spot: number;
  target: number | null;
  invalidation: number | null;
  direction: "up" | "down" | "neutral";
}

export function RiskPanel({ spot, target, invalidation, direction }: Props) {
  const [balance, setBalance] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);
  const [lev, setLev] = useState(5);

  // entrada = spot · stop = invalidación · take profit = objetivo
  const entry = spot;
  const stop = invalidation;
  const tp = target;

  const calc = useMemo(() => {
    if (!spot || spot <= 0 || stop == null || stop <= 0 || tp == null || tp <= 0) return null;
    const riskUsdt = (balance * riskPct) / 100;
    const stopDistPct = Math.abs(entry - stop) / entry;
    const tpDistPct = Math.abs(tp - entry) / entry;
    if (stopDistPct <= 0) return null;

    const positionUsdt = riskUsdt / stopDistPct; // nocional que, al tocar stop, pierde exactamente riskUsdt
    const qtyBtc = positionUsdt / entry;
    const margin = positionUsdt / lev;
    const rr = tpDistPct / stopDistPct;

    // distancia de liquidación aproximada al apalancamiento elegido (MMR 0.4%)
    const liqDistPct = Math.max(1 / lev - 0.004, 0.001);
    const stopBeyondLiq = stopDistPct >= liqDistPct;

    return { riskUsdt, positionUsdt, qtyBtc, margin, rr, stopDistPct, tpDistPct, liqDistPct, stopBeyondLiq };
  }, [balance, riskPct, lev, entry, stop, tp]);

  const long = direction === "up";
  const acc = long ? "#2fd6a5" : "#ff4d6d";

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">07 · gestión de riesgo</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Dimensiona tu posición
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mist">
            El radar te da el <b className="text-fog">objetivo</b> (imán de liquidez) y la <b className="text-fog">invalidación</b>.
            Esta calculadora convierte esos niveles en un tamaño de posición donde — si el mercado toca la invalidación —
            pierdes <b className="text-fog">exactamente el % de cuenta que decidas</b>, ni un dólar más.
          </p>
        </div>
        <span
          className="rounded-md border px-2.5 py-1 font-mono text-[10px] font-700 tracking-widest"
          style={{ color: acc, borderColor: `${acc}55`, background: `${acc}0f` }}
        >
          {direction === "up" ? "OPERACIÓN EN LONG" : direction === "down" ? "OPERACIÓN EN SHORT" : "SIN SESGO"}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* entradas */}
        <div className="flex flex-col gap-3.5">
          <label className="block">
            <span className="panel-tag">capital de la cuenta (USDT)</span>
            <input
              type="number"
              min={1}
              value={balance}
              onChange={(e) => setBalance(Math.max(0, Number(e.target.value)))}
              className="mt-1.5 w-full rounded-md border border-line bg-ink-950/70 px-3 py-2 font-mono text-sm tabular-nums text-fog outline-none transition-colors focus:border-long/60"
            />
          </label>

          <label className="block">
            <span className="panel-tag flex justify-between">
              riesgo por operación <b className="text-warn">{riskPct}%</b>
            </span>
            <input
              type="range"
              min={0.25}
              max={5}
              step={0.25}
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              className="mt-2 w-full accent-[#ffb547]"
            />
          </label>

          <label className="block">
            <span className="panel-tag flex justify-between">
              apalancamiento <b className="text-pulse">{lev}×</b>
            </span>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={lev}
              onChange={(e) => setLev(Number(e.target.value))}
              className="mt-2 w-full accent-[#3fb6ff]"
            />
          </label>

          <div className="rounded-md border border-line/60 bg-ink-950/50 p-3 font-mono text-[10.5px] leading-relaxed tabular-nums">
            <div className="flex justify-between text-mist"><span>entrada (spot)</span><span className="text-fog">{fmtUsd(entry)}</span></div>
            <div className="flex justify-between text-mist"><span>invalidación (stop)</span><span className="text-short-hi">{stop ? fmtUsd(stop) : "—"}</span></div>
            <div className="flex justify-between text-mist"><span>imán (take profit)</span><span className="text-long-hi">{tp ? fmtUsd(tp) : "—"}</span></div>
          </div>
        </div>

        {/* resultados */}
        {calc ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="riesgo asumido" value={fmtUsd(calc.riskUsdt)} sub={`${riskPct}% de la cuenta`} color="#ffb547" />
            <Stat label="tamaño de posición" value={fmtUsd(calc.positionUsdt)} sub="nocional total" color={acc} />
            <Stat label="cantidad" value={`${calc.qtyBtc.toFixed(4)} BTC`} sub={`margen ${fmtUsd(calc.margin)}`} color="#3fb6ff" />
            <Stat label="riesgo : beneficio" value={`1 : ${calc.rr.toFixed(2)}`} sub={calc.rr >= 1.5 ? "favorable" : calc.rr >= 1 ? "aceptable" : "desfavorable"} color={calc.rr >= 1.5 ? "#2fd6a5" : calc.rr >= 1 ? "#ffb547" : "#ff4d6d"} />

            <div className="col-span-2 rounded-md border border-line/60 bg-ink-950/50 p-3 xl:col-span-4">
              <div className="grid grid-cols-3 gap-3 font-mono text-[10.5px] tabular-nums">
                <div><span className="panel-tag">distancia al stop</span><div className="mt-0.5 text-sm font-700 text-short-hi">{(calc.stopDistPct * 100).toFixed(2)}%</div></div>
                <div><span className="panel-tag">distancia al imán</span><div className="mt-0.5 text-sm font-700 text-long-hi">{(calc.tpDistPct * 100).toFixed(2)}%</div></div>
                <div><span className="panel-tag">liquidación a {lev}×</span><div className="mt-0.5 text-sm font-700 text-pulse">≈ {(calc.liqDistPct * 100).toFixed(2)}%</div></div>
              </div>
              {calc.stopBeyondLiq && (
                <div className="mt-2.5 flex items-start gap-2 rounded-md border border-short/40 bg-short/[0.07] px-3 py-2 text-[11px] leading-snug text-short-hi">
                  <span className="mt-0.5">⚠</span>
                  <span>
                    El stop está <b>más lejos</b> que tu punto de liquidación a {lev}×: te liquidarían antes de tocar la
                    invalidación. Sube el apalancamiento con cuidado o reduce el riesgo — la invalidación debe quedar siempre
                    dentro de tu margen de liquidación.
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-md border border-dashed border-line/70 font-mono text-[11px] text-dusk">
            Esperando a que el radar fije objetivo e invalidación…
          </div>
        )}
      </div>

      <p className="mt-4 border-t border-line/40 pt-3 font-mono text-[10.5px] leading-relaxed text-dusk">
        Regla de oro: el tamaño lo dicta el riesgo, no la convicción. Si la distancia a la invalidación es grande, la posición
        debe ser pequeña; si es corta, puede ser mayor. Nunca muevas el stop en contra — la invalidación del radar es el nivel
        donde el escenario deja de ser cierto.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg border border-line/60 bg-ink-950/50 p-3.5 transition-transform duration-200 hover:-translate-y-0.5">
      <span className="panel-tag">{label}</span>
      <div className="mt-1 font-mono text-xl font-700 tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-0.5 font-mono text-[10px] text-dusk">{sub}</div>
    </div>
  );
}
