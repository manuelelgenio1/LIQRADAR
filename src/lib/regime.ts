/* ============================================================
   Market Regime — state-first: el estado del mercado actúa como
   GUARDIA antes de emitir dirección. Un régimen sin ventaja
   bloquea la señal en vez de promediar ruido.

   OI regimes (posición + apalancamiento):
     LONG BUILD    precio↑ + OI↑  → longs nuevos (combustible bajista)
     SHORT BUILD   precio↓ + OI↑  → shorts nuevos (combustible alcista)
     LONG UNWIND   precio↓ + OI↓  → longs cerrando (descarga bajista)
     SHORT UNWIND  precio↑ + OI↓  → shorts cerrando (descarga alcista)
   ============================================================ */

export type OIRegime = "LONG_BUILD" | "SHORT_BUILD" | "LONG_UNWIND" | "SHORT_UNWIND" | "NEUTRAL";

export type MarketRegimeState =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "COMPRESSION"
  | "EXPANSION"
  | "CHOP";

export interface MarketRegime {
  state: MarketRegimeState;
  label: string;
  color: string;
  note: string;
  allowUp: boolean;
  allowDown: boolean;
  oi: OIRegime;
  oiLabel: string;
}

export interface RegimeInput {
  slowSlopePct: number; // tendencia de la ventana completa
  fastSlopePct: number; // tendencia del tercio reciente
  momPct: number; // impulso de las últimas velas
  atrPct: number; // ATR/h como % del precio
  oiSlope5m: number; // % en 2.5h
  oiChange24h: number; // %
  priceChange24h: number; // %
}

export function classifyOIRegime(priceChg: number, oiChg: number): { regime: OIRegime; label: string } {
  const p = Math.abs(priceChg) >= 0.35;
  const o = Math.abs(oiChg) >= 0.6;
  if (p && o) {
    if (priceChg > 0 && oiChg > 0) return { regime: "LONG_BUILD", label: "LONG BUILD" };
    if (priceChg < 0 && oiChg > 0) return { regime: "SHORT_BUILD", label: "SHORT BUILD" };
    if (priceChg < 0 && oiChg < 0) return { regime: "LONG_UNWIND", label: "LONG UNWIND" };
    if (priceChg > 0 && oiChg < 0) return { regime: "SHORT_UNWIND", label: "SHORT UNWIND" };
  }
  return { regime: "NEUTRAL", label: "NEUTRAL" };
}

export function classifyMarketRegime(inp: RegimeInput): MarketRegime {
  const { slowSlopePct: slow, fastSlopePct: fast, momPct, atrPct, priceChange24h, oiSlope5m } = inp;

  // OI regime usa el cambio 24h + la pendiente reciente
  const oiMixed = oiSlope5m !== 0 ? oiSlope5m : inp.oiChange24h / 10;
  const oi = classifyOIRegime(priceChange24h, inp.oiChange24h !== 0 ? inp.oiChange24h : oiMixed);

  let state: MarketRegimeState;

  if (atrPct >= 0.8) {
    state = "EXPANSION";
  } else if (atrPct < 0.16 && Math.abs(fast) < 0.2) {
    state = "COMPRESSION";
  } else if (slow > 0.7 && fast > 0.2) {
    state = "TREND_UP";
  } else if (slow < -0.7 && fast < -0.2) {
    state = "TREND_DOWN";
  } else if (Math.abs(slow) < 0.6 && Math.abs(fast) < 0.35) {
    state = "RANGE";
  } else {
    state = "CHOP";
  }

  const base = { oi: oi.regime, oiLabel: oi.label };

  switch (state) {
    case "TREND_UP":
      return {
        ...base,
        state,
        label: "TENDENCIA ALCISTA",
        color: "#2fd6a5",
        note: "Tendencia establecida hacia arriba: las señales a favor tienen ventaja; ir en contra exige confirmación extra de barrido.",
        allowUp: true,
        allowDown: false,
      };
    case "TREND_DOWN":
      return {
        ...base,
        state,
        label: "TENDENCIA BAJISTA",
        color: "#ff4d6d",
        note: "Tendencia establecida hacia abajo: las señales a favor tienen ventaja; ir en contra exige confirmación extra de barrido.",
        allowUp: false,
        allowDown: true,
      };
    case "RANGE":
      return {
        ...base,
        state,
        label: "RANGO",
        color: "#3fb6ff",
        note: "Mercado lateral: los extremos del rango y los imanes de liquidez mandan. Ambos lados operables.",
        allowUp: true,
        allowDown: true,
      };
    case "COMPRESSION":
      return {
        ...base,
        state,
        label: "COMPRESIÓN",
        color: "#e05cd0",
        note: "Volatilidad comprimida: se está acumulando energía. Espera la expansión — las barridas suelen ser violentas.",
        allowUp: true,
        allowDown: true,
      };
    case "EXPANSION":
      return {
        ...base,
        state,
        label: "EXPANSIÓN",
        color: "#ffb547",
        note: "Volatilidad en expansión: solo a favor del impulso del momento; en contra es atrapar cuchillos.",
        allowUp: momPct >= 0,
        allowDown: momPct <= 0,
      };
    case "CHOP":
    default:
      return {
        ...base,
        state: "CHOP",
        label: "CHOP · SIN VENTAJA",
        color: "#93a5c8",
        note: "Señales cruzadas entre plazos: el mercado no ofrece ventaja direccional clara. Señal bloqueada por régimen.",
        allowUp: false,
        allowDown: false,
      };
  }
}
