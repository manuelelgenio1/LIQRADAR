/* ============================================================
   Sentimiento del mercado de opciones de BTC (Binance Options).
   Dimensión pública nueva del catálogo de Binance: el put/call
   ratio por interés abierto es un indicador de posicionamiento
   que refuerza la escuela contrarian del motor.

   Todo es defensivo y acotado: si un paso falla, devuelve null
   y el factor queda neutro — nunca rompe la herramienta.
   ============================================================ */

export interface OptionsSentiment {
  putCallRatio: number; // OI puts / OI calls (1 = equilibrado)
  putOi: number; // USDT nocional en puts
  callOi: number; // USDT nocional en calls
  totalOi: number; // USDT
  indexPrice: number; // índice de opciones BTC
  strikes: number; // nº de strikes muestreados
  expiry: number; // ms del vencimiento usado
}

const EAPI = "https://eapi.binance.com";

async function getJson<T>(url: string, timeoutMs = 6000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

interface OptSymbol {
  symbol: string; // p.ej. BTC-260327-100000-C
  underlying: string;
  expiry: number; // ms
  strikePrice: string;
  side: "CALL" | "PUT";
  status?: string;
}

interface ExchangeInfo {
  symbols?: OptSymbol[];
}

interface OiResponse {
  symbol: string;
  openInterest: number; // nº de contratos
  time?: number;
}

interface IndexResponse {
  indexPrice?: string;
}

/* Tamaño de contrato BTC en las opciones de Binance (0.01 BTC) */
const CONTRACT = 0.01;
/* Máximo de strikes muestreados por lado (acota las peticiones) */
const MAX_PER_SIDE = 8;

export async function fetchOptionsSentiment(): Promise<OptionsSentiment | null> {
  // 1 · índice de opciones (una sola petición)
  let indexPrice = 0;
  try {
    const idx = await getJson<IndexResponse[]>(`${EAPI}/eapi/v1/index?underlying=BTCUSDT`);
    indexPrice = Number(idx?.[0]?.indexPrice ?? 0);
  } catch {
    /* seguimos sin índice */
  }

  // 2 · catálogo de opciones
  let info: ExchangeInfo;
  try {
    info = await getJson<ExchangeInfo>(`${EAPI}/eapi/v1/exchangeInfo`);
  } catch {
    return null;
  }
  const syms = (info.symbols ?? []).filter(
    (s) => s.underlying === "BTCUSDT" && (s.status === undefined || s.status === "TRADING")
  );
  if (syms.length === 0) return null;

  // 3 · vencimiento más cercano en el futuro
  const now = Date.now();
  const future = syms.filter((s) => s.expiry > now);
  if (future.length === 0) return null;
  const expiry = Math.min(...future.map((s) => s.expiry));
  const near = syms.filter((s) => s.expiry === expiry);

  // 4 · strikes ATM ± unos pocos, acotados por lado
  const atm = indexPrice > 0 ? indexPrice : Number(near[0].strikePrice);
  const byDist = (s: OptSymbol) => Math.abs(Number(s.strikePrice) - atm);
  const calls = near.filter((s) => s.side === "CALL").sort((a, b) => byDist(a) - byDist(b)).slice(0, MAX_PER_SIDE);
  const puts = near.filter((s) => s.side === "PUT").sort((a, b) => byDist(a) - byDist(b)).slice(0, MAX_PER_SIDE);
  if (calls.length === 0 || puts.length === 0) return null;

  // 5 · interés abierto de cada strike muestreado (en paralelo, acotado)
  const fetchOi = async (s: OptSymbol): Promise<OiResponse | null> => {
    try {
      return await getJson<OiResponse>(`${EAPI}/eapi/v1/openInterest?symbol=${s.symbol}`);
    } catch {
      return null;
    }
  };
  const [callOis, putOis] = await Promise.all([
    Promise.all(calls.map(fetchOi)),
    Promise.all(puts.map(fetchOi)),
  ]);

  const sumOi = (arr: (OiResponse | null)[]) =>
    arr.reduce((a, r) => a + (r && Number.isFinite(Number(r.openInterest)) ? Number(r.openInterest) : 0), 0);

  const callContracts = sumOi(callOis);
  const putContracts = sumOi(putOis);
  if (callContracts <= 0 && putContracts <= 0) return null;

  const callOi = callContracts * CONTRACT * atm;
  const putOi = putContracts * CONTRACT * atm;
  const putCallRatio = callContracts > 0 ? putContracts / callContracts : putContracts > 0 ? 2 : 1;

  return {
    putCallRatio,
    putOi,
    callOi,
    totalOi: putOi + callOi,
    indexPrice: indexPrice || atm,
    strikes: calls.length + puts.length,
    expiry,
  };
}
