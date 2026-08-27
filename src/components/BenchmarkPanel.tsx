/* ============================================================
   Benchmark competitivo: LiqRadar vs las herramientas de
   referencia del mercado, verificado contra sus propias webs
   y documentación pública (feb 2026).
   ============================================================ */

type Cell = "yes" | "partial" | "no";

interface Row {
  feature: string;
  detail: string;
  cells: [Cell, Cell, Cell, Cell]; // LiqRadar, Coinglass, Kingfisher, Hyblock
}

const ROWS: Row[] = [
  {
    feature: "Heatmap de liquidación 2D (tiempo × precio)",
    detail: "Coinglass lo describe como una estimación de dónde «pueden ocurrir» liquidaciones; Kingfisher usa niveles reales solo donde el exchange los publica (Binance no); Hyblock estima con su propio modelo.",
    cells: ["yes", "yes", "partial", "yes"],
  },
  {
    feature: "Niveles de liquidación reales del exchange",
    detail: "Ningún exchange grande (Binance, OKX, Bybit) publica las órdenes de liquidación abiertas: quien diga tenerlas para Binance, las está estimando.",
    cells: ["no", "no", "partial", "no"],
  },
  {
    feature: "Cinta de liquidaciones en vivo",
    detail: "Stream !forceOrder de Binance: liquidaciones ejecutadas al segundo.",
    cells: ["yes", "yes", "yes", "yes"],
  },
  {
    feature: "Históricos de funding, OI y ratios",
    detail: "Series históricas trazadas en el tiempo (panel «pulso del mercado»).",
    cells: ["yes", "yes", "yes", "yes"],
  },
  {
    feature: "Delta de takers (CVD) y divergencias",
    detail: "Volumen de compra agresiva por vela + detección automática de divergencia precio/CVD.",
    cells: ["yes", "partial", "no", "yes"],
  },
  {
    feature: "Veredicto direccional (long/short) con objetivo e invalidación",
    detail: "Motor de 12 factores ponderados con imán de liquidez, nivel que anula el escenario y ventana temporal.",
    cells: ["yes", "no", "no", "partial"],
  },
  {
    feature: "Backtest del propio modelo (walk-forward, sin lookahead)",
    detail: "Ninguna de las grandes publica su tasa de acierto: la venden como certeza. Aquí se mide contra la historia real.",
    cells: ["yes", "no", "no", "partial"],
  },
  {
    feature: "Auditoría de integridad en tiempo real",
    detail: "Panel que verifica cada fuente y cada cálculo, con transparencia total sobre el modo simulado.",
    cells: ["yes", "no", "no", "no"],
  },
  {
    feature: "Alertas configurables + webhook (Telegram/Discord)",
    detail: "Modo francotirador con umbrales de sesgo y confianza, aviso sonoro y envío del evento en JSON al webhook que configures. En las grandes, las alertas suelen ser de pago.",
    cells: ["yes", "partial", "partial", "partial"],
  },
  {
    feature: "Agregación multi-exchange (10+ exchanges)",
    detail: "El radar compara en vivo Binance, OKX y Bybit (los tres mayores por volumen) con señales de divergencia; Coinglass cubre una decena.",
    cells: ["partial", "yes", "yes", "yes"],
  },
  {
    feature: "Order book L2 / footprint / opciones",
    detail: "Profundidad de libro en vivo con detección de muros y desequilibrio (panel «order flow»); footprint por vela y opciones siguen siendo terreno de Hyblock y Coinglass Pro.",
    cells: ["partial", "partial", "no", "yes"],
  },
];

const TOOLS = [
  { name: "LiqRadar", tag: "esta app", price: "gratis · sin cuenta", color: "#2fd6a5" },
  { name: "Coinglass", tag: "referencia", price: "freemium · pro ≈ $99/mes", color: "#93a5c8" },
  { name: "Kingfisher", tag: "referencia", price: "≈ $35–50/mes", color: "#93a5c8" },
  { name: "Hyblock", tag: "gama alta", price: "≈ $150–300/mes", color: "#93a5c8" },
];

function Mark({ c }: { c: Cell }) {
  if (c === "yes")
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-label="sí">
        <circle cx="8" cy="8" r="7" fill="rgba(47,214,165,0.12)" stroke="rgba(47,214,165,0.5)" />
        <path d="M4.6 8.3l2.3 2.3 4.5-5.2" stroke="#5ef2c4" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (c === "partial")
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-label="parcial">
        <circle cx="8" cy="8" r="7" fill="rgba(255,181,71,0.1)" stroke="rgba(255,181,71,0.5)" />
        <path d="M4.5 8h7" stroke="#ffb547" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-label="no">
      <circle cx="8" cy="8" r="7" fill="rgba(255,77,109,0.08)" stroke="rgba(255,77,109,0.35)" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ff7d95" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BenchmarkPanel() {
  const ours = ROWS.reduce((a, r) => a + (r.cells[0] === "yes" ? 1 : r.cells[0] === "partial" ? 0.5 : 0), 0);

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="panel-tag">12 · benchmark competitivo</div>
          <h2 className="font-display mt-1 text-lg font-700 tracking-tight text-fog sm:text-xl">
            Frente a las herramientas que usa el mercado
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-mist">
            Comparativa verificada contra las webs y documentación pública de cada plataforma (feb&nbsp;2026). Sin
            marketing: las casillas rojas son carencias reales de esta app.
          </p>
        </div>
        <div className="rounded-md border border-long/40 bg-long/[0.07] px-3.5 py-2 font-mono text-[11px] text-long-hi">
          cobertura LiqRadar: <b>{ours.toFixed(1)}/{ROWS.length}</b> funciones clave
        </div>
      </div>

      {/* hallazgo clave */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-pulse/30 bg-pulse/[0.05] p-4">
          <div className="font-mono text-[10px] font-700 tracking-widest text-pulse">HALLAZGO 01 · LA PRECISIÓN</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
            <b className="text-fog">Nadie publica su tasa de acierto.</b> Coinglass define su heatmap como una{" "}
            <i>estimación</i> de dónde «pueden ocurrir» liquidaciones masivas; Kingfisher solo tiene niveles reales en
            exchanges que los publican (Binance no está entre ellos). El mapa de cualquiera — incluido este — es un
            modelo, no una verdad.
          </p>
        </div>
        <div className="rounded-lg border border-long/30 bg-long/[0.05] p-4">
          <div className="font-mono text-[10px] font-700 tracking-widest text-long">HALLAZGO 02 · LA DIFERENCIA</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
            Esta es la única herramienta del cuadro que <b className="text-fog">mide su propio rendimiento</b>: el
            laboratorio re-ejecuta el motor contra 41 días de historia (panel 10) y la auditoría en vivo (panel 11)
            verifica cada dato. Las demás piden fe; esta enseña los números.
          </p>
        </div>
        <div className="rounded-lg border border-warn/30 bg-warn/[0.05] p-4">
          <div className="font-mono text-[10px] font-700 tracking-widest text-warn">HALLAZGO 03 · EL PRECIO</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
            Las funciones equivalentes cuestan <b className="text-fog">entre $35 y $300 al mes</b> en las plataformas de
            referencia. Aquí son gratis y corren en tu navegador contra la API pública de Binance — con la honestidad de
            marcar en ámbar cuando tu red obliga a usar el simulador.
          </p>
        </div>
      </div>

      {/* matriz */}
      <div className="slim-scroll mt-5 overflow-x-auto rounded-lg border border-line/60">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="bg-ink-950/70">
              <th className="px-4 py-3 font-mono text-[10px] font-700 tracking-widest text-dusk">FUNCIÓN</th>
              {TOOLS.map((t) => (
                <th key={t.name} className="px-3 py-3 text-center">
                  <div className="font-mono text-[12px] font-700" style={{ color: t.color }}>
                    {t.name}
                  </div>
                  <div className="font-mono text-[9px] text-dusk">{t.tag}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr
                key={r.feature}
                className={`group border-t border-line/40 transition-colors hover:bg-ink-950/50 ${i % 2 === 1 ? "bg-ink-950/25" : ""}`}
              >
                <td className="px-4 py-2.5">
                  <div className="text-[12.5px] font-600 text-fog">{r.feature}</div>
                  <div className="mt-0.5 max-w-md text-[10.5px] leading-snug text-dusk">{r.detail}</div>
                </td>
                {r.cells.map((c, j) => (
                  <td key={j} className={`px-3 py-2.5 text-center ${j === 0 ? "bg-long/[0.04]" : ""}`}>
                    <span className="inline-flex justify-center transition-transform duration-150 group-hover:scale-110">
                      <Mark c={c} />
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-line/70 bg-ink-950/70">
              <td className="px-4 py-3 font-mono text-[10px] font-700 tracking-widest text-dusk">PRECIO</td>
              {TOOLS.map((t) => (
                <td key={t.name} className={`px-3 py-3 text-center font-mono text-[10.5px] tabular-nums ${t.color === "#2fd6a5" ? "font-700 text-long-hi" : "text-mist"}`}>
                  {t.price}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] leading-relaxed text-dusk">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-long" />sí</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warn" />parcial</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-short" />no</span>
        <span>· Fuentes: coinglass.com/learn (metodología del heatmap), thekingfisher.io (LiqMap vs Heatmap),
        hyblockcapital.com, review de la API de CoinGlass y comparativas públicas de 2026. Precios orientativos.</span>
      </p>
    </div>
  );
}
