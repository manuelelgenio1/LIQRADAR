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

/* ============================================================
   IV ATM, skew y Max Pain — aproximaciones declaradas a partir
   de precios y OI OBSERVADOS (Black-Scholes invertido por
   bisección; r=0). No son superficies de volatilidad oficiales.
   ============================================================ */

export interface OptionsAdvanced {
  atmIv: number | null; // vol implícita ATM (fracción anualizada)
  skew: number | null; // IV put OTM − IV call OTM (riesgo bajista percibido)
  maxPain: number | null; // strike de mínimo dolor para los vendedores
  note: string;
}

function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function bsPrice(S: number, K: number, iv: number, T: number, call: boolean): number {
  if (T <= 0 || iv <= 0) return Math.max(call ? S - K : K - S, 0);
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (iv * iv * T) / 2) / sq;
  const d2 = d1 - sq;
  return call ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}

function impliedIV(px: number, S: number, K: number, T: number, call: boolean): number | null {
  let lo = 0.01;
  let hi = 5;
  if (bsPrice(S, K, hi, T, call) < px) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const v = bsPrice(S, K, mid, T, call);
    if (v < px) lo = mid;
    else hi = mid;
  }
  const iv = (lo + hi) / 2;
  return iv >= 0.01 && iv <= 5 ? iv : null;
}

interface Ticker {
  lastPrice?: string;
}

export async function fetchOptionsAdvanced(): Promise<OptionsAdvanced> {
  const none: OptionsAdvanced = { atmIv: null, skew: null, maxPain: null, note: "" };
  try {
    const idxRes = await getJson<IndexResponse[]>(`${EAPI}/eapi/v1/index?underlying=BTCUSDT`);
    const S = Number(idxRes?.[0]?.indexPrice ?? 0);
    if (!Number.isFinite(S) || S <= 0) return { ...none, note: "sin índice de opciones" };

    const info = await getJson<ExchangeInfo>(`${EAPI}/eapi/v1/exchangeInfo`);
    const syms = (info.symbols ?? []).filter(
      (s) => s.underlying === "BTCUSDT" && (s.status === undefined || s.status === "TRADING")
    );
    const now = Date.now();
    const future = syms.filter((s) => s.expiry > now);
    if (future.length === 0) return { ...none, note: "sin vencimientos futuros" };
    const expiry = Math.min(...future.map((s) => s.expiry));
    const near = syms.filter((s) => s.expiry === expiry);
    const T = Math.max((expiry - now) / (365 * 24 * 3600_000), 1 / (365 * 24));

    const byDist = (s: OptSymbol) => Math.abs(Number(s.strikePrice) - S);
    const calls = near.filter((s) => s.side === "CALL");
    const puts = near.filter((s) => s.side === "PUT");
    const atmCall = [...calls].sort(byDist)[0];
    const atmPut = [...puts].sort(byDist)[0];
    const otmPut = [...puts].sort((a, b) => Math.abs(Number(a.strikePrice) - S * 0.95) - Math.abs(Number(b.strikePrice) - S * 0.95))[0];
    const otmCall = [...calls].sort((a, b) => Math.abs(Number(a.strikePrice) - S * 1.05) - Math.abs(Number(b.strikePrice) - S * 1.05))[0];
    if (!atmCall || !atmPut) return { ...none, note: "sin strikes ATM" };

    const lastPx = async (sym: string): Promise<number> => {
      try {
        const t = await getJson<Ticker>(`${EAPI}/eapi/v1/ticker?symbol=${sym}`);
        return Number(t?.lastPrice ?? NaN);
      } catch {
        return NaN;
      }
    };
    const [pxAc, pxAp, pxOp, pxOc] = await Promise.all([
      lastPx(atmCall.symbol),
      lastPx(atmPut.symbol),
      otmPut ? lastPx(otmPut.symbol) : Promise.resolve(NaN),
      otmCall ? lastPx(otmCall.symbol) : Promise.resolve(NaN),
    ]);

    const minPx = 0.002 * S; // descarta precios ilíquidos
    const ivAc = Number.isFinite(pxAc) && pxAc > minPx ? impliedIV(pxAc, S, Number(atmCall.strikePrice), T, true) : null;
    const ivAp = Number.isFinite(pxAp) && pxAp > minPx ? impliedIV(pxAp, S, Number(atmPut.strikePrice), T, false) : null;
    const atmIv = ivAc !== null && ivAp !== null ? (ivAc + ivAp) / 2 : ivAc ?? ivAp;

    let skew: number | null = null;
    if (otmPut && otmCall) {
      const ivP = Number.isFinite(pxOp) && pxOp > minPx ? impliedIV(pxOp, S, Number(otmPut.strikePrice), T, false) : null;
      const ivC = Number.isFinite(pxOc) && pxOc > minPx ? impliedIV(pxOc, S, Number(otmCall.strikePrice), T, true) : null;
      if (ivP !== null && ivC !== null) skew = ivP - ivC;
    }

    // Max Pain: strike que minimiza el payout agregado (OI observado, top 16 por lado)
    const wideC = [...calls].sort(byDist).slice(0, 16);
    const wideP = [...puts].sort(byDist).slice(0, 16);
    const oiOf = async (s: OptSymbol): Promise<{ K: number; oi: number }> => {
      try {
        const r = await getJson<OiResponse>(`${EAPI}/eapi/v1/openInterest?symbol=${s.symbol}`);
        const oi = Number(r?.openInterest ?? 0);
        return { K: Number(s.strikePrice), oi: Number.isFinite(oi) ? oi : 0 };
      } catch {
        return { K: Number(s.strikePrice), oi: 0 };
    } };
    const [cOis, pOis] = await Promise.all([Promise.all(wideC.map(oiOf)), Promise.all(wideP.map(oiOf))]);
    const candidates = [...cOis, ...pOis].filter((x) => x.oi > 0);
    let maxPain: number | null = null;
    if (candidates.length >= 4) {
      let best = Infinity;
      for (const k0 of candidates) {
        let pain = 0;
        for (const c of cOis) pain += c.oi * Math.max(0, k0.K - c.K);
        for (const p of pOis) pain += p.oi * Math.max(0, p.K - k0.K);
        if (pain < best) {
          best = pain;
          maxPain = k0.K;
        }
      }
    }

    const parts: string[] = [];
    if (atmIv === null) parts.push("IV sin liquidez suficiente");
    if (skew === null) parts.push("skew no disponible");
    if (maxPain === null) parts.push("max pain no disponible");
    return { atmIv, skew, maxPain, note: parts.join(" · ") };
  } catch (e) {
    return { ...none, note: e instanceof Error ? e.message : "error consultando opciones" };
  }
}
