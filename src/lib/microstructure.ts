/* ============================================================
   Microestructura avanzada sobre datos REALES capturados:
   - Absorción: flujo agresivo grande + precio que NO responde +
     profundidad que persiste/se repone → un participante pasivo
     está absorbiendo. Suele marcar suelo/techo.
   - Riesgo spoof/pull: niveles grandes que aparecen y se retiran
     rápido. SIEMPRE se reporta como riesgo heurístico, nunca
     como manipulación confirmada.
   La historia empieza cuando arranca la captura: no se inventa
   microestructura retrohistórica.
   ============================================================ */

import type { L2Frame } from "./l2";
import type { CvdState } from "./streams";

export interface Absorption {
  side: "bid" | "ask" | "none"; // bid = ventas agresivas absorbidas (alcista)
  score: number; // 0..1
  note: string;
}

export interface SpoofRisk {
  risk: number; // 0..100
  events: number;
  note: string;
}

export interface MicroState {
  absorption: Absorption;
  spoof: SpoofRisk;
  historySec: number; // segundos de captura real acumulada
}

const startedAt = Date.now();

/* Rastreo de niveles grandes que aparecen (para riesgo pull) */
interface BigLevel {
  firstSeen: number;
  gone: boolean;
}
const bigSeen = new Map<string, BigLevel>();
let lastFrameCheck = 0;
let pullEvents = 0;

function trackPulls(frames: L2Frame[], medianNotional: number) {
  if (frames.length < 2) return;
  const now = Date.now();
  if (now - lastFrameCheck < 1000) return;
  lastFrameCheck = now;
  const latest = frames[frames.length - 1];
  const prev = frames[frames.length - 2];
  const threshold = medianNotional * 3;

  const prevKeys = new Set<string>();
  for (const l of [...prev.bids, ...prev.asks]) prevKeys.add(`${l.p}`);
  const latestMap = new Map<number, number>();
  for (const l of [...latest.bids, ...latest.asks]) latestMap.set(l.p, l.p * l.q);

  // niveles grandes NUEVOS
  for (const l of [...latest.bids, ...latest.asks]) {
    const key = `${l.p}`;
    const notional = l.p * l.q;
    if (notional >= threshold && !prevKeys.has(key) && !bigSeen.has(key)) {
      bigSeen.set(key, { firstSeen: now, gone: false });
    }
  }
  // niveles grandes que DESAPARECIERON en menos de 4s
  for (const [key, info] of bigSeen) {
    if (info.gone) continue;
    const p = Number(key);
    if (!latestMap.has(p) && now - info.firstSeen < 4000 && now - info.firstSeen >= 500) {
      info.gone = true;
      pullEvents++;
    }
  }
  // limpieza
  if (bigSeen.size > 200) {
    for (const [k, v] of bigSeen) if (now - v.firstSeen > 30_000) bigSeen.delete(k);
  }
}

export function computeMicro(frames: L2Frame[], spotCvd: CvdState, futCvd: CvdState, atrPct: number): MicroState {
  const historySec = Math.floor((Date.now() - startedAt) / 1000);

  // mediana de nocional de los niveles actuales
  let median = 1;
  if (frames.length > 0) {
    const last = frames[frames.length - 1];
    const notionals = [...last.bids, ...last.asks].map((l) => l.p * l.q).sort((a, b) => a - b);
    median = notionals[Math.floor(notionals.length / 2)] || 1;
  }
  trackPulls(frames, median);

  /* ---------- absorción (ventana 5m de CVD vs respuesta de precio) ---------- */
  let absorption: Absorption = { side: "none", score: 0, note: "Sin absorción destacada en la ventana." };
  if (frames.length >= 5) {
    const cvd = futCvd.cvd5m !== 0 ? futCvd : spotCvd;
    const first = frames[Math.max(0, frames.length - 1 - Math.floor(150_000 / 2000))]; // ~2.5 min de frames
    const last = frames[frames.length - 1];
    if (first && last && last.t - first.t > 30_000) {
      const priceMove = Math.abs(last.bids[0]?.p ?? 0 - (first.bids[0]?.p ?? 0));
      const expectedMove = (atrPct / 100) * (first.bids[0]?.p ?? 1) * 0.5;
      const flowBig = Math.abs(cvd.cvd5m) > 400_000; // flujo agresivo relevante
      const priceQuiet = priceMove < Math.max(expectedMove * 0.35, 1);
      const depthHeld = cvd.cvd5m < 0 ? last.bidTotal >= first.bidTotal * 0.85 : last.askTotal >= first.askTotal * 0.85;

      if (flowBig && priceQuiet && depthHeld) {
        const side: "bid" | "ask" = cvd.cvd5m < 0 ? "bid" : "ask";
        const score = Math.min(1, (Math.abs(cvd.cvd5m) / 2_000_000) * (1 - priceMove / Math.max(expectedMove, 1)));
        absorption = {
          side,
          score,
          note:
            side === "bid"
              ? "Ventas agresivas ABSORBIDAS por compradores pasivos: el precio no cae pese al flujo vendedor — posible suelo."
              : "Compras agresivas ABSORBIDAS por vendedores pasivos: el precio no sube pese al flujo comprador — posible techo.",
        };
      }
    }
  }

  /* ---------- riesgo spoof/pull ---------- */
  const risk = Math.min(100, pullEvents * 9);
  const spoof: SpoofRisk = {
    risk,
    events: pullEvents,
    note:
      pullEvents === 0
        ? "Sin retiradas sospechosas de liquidez reciente."
        : `${pullEvents} niveles grandes retirados en <4s. RIESGO de spoof/pull — heurística, no es manipulación confirmada.`,
  };

  return { absorption, spoof, historySec };
}
