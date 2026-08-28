/* ============================================================
   Conector de clusters de liquidación EXTERNOS (opcional).
   Fuentes: CoinGlass v4 o un endpoint JSON personalizado.

   Reglas del handoff (5, 7, 9):
   - Las credenciales NUNCA van en frontend/bundle. Solo en el
     .env del servidor local (COINGLASS_API_KEY / EXTERNAL_LIQUIDITY_URL).
   - Los clusters externos son ESTIMACIONES, no posiciones observadas.
   - El `side` de CoinGlass no se afirma como observado; si falta se
     infiere del nivel vs precio actual (sideOrigin=inferred) o queda
     "unknown" — nunca se fuerza arbitrariamente a long/short.
   - Si el proveedor no está disponible, la fuente queda UNAVAILABLE.
     No se genera liquidez sintética.
   ============================================================ */

import { markSource } from "./dataTruth";

export type SideOrigin = "provider" | "inferred" | "unknown";

export interface ExternalCluster {
  price: number;
  notional: number; // USDT estimado
  side: "long" | "short" | "unknown";
  sideOrigin: SideOrigin;
}

export interface ExternalClusterSet {
  provider: "coinglass" | "custom";
  clusters: ExternalCluster[];
  fetchedAt: number;
  note: string;
}

let cached: ExternalClusterSet | null = null;
let tried = false;
let lastAttempt = 0;
const RETRY_MS = 120_000; // no martillear el proxy

interface RawCluster {
  price?: number | string;
  notional?: number | string;
  amount?: number | string;
  side?: string;
}

function toCluster(raw: RawCluster, spot: number): ExternalCluster | null {
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const notional = Number(raw.notional ?? raw.amount ?? 0);

  let side: ExternalCluster["side"] = "unknown";
  let sideOrigin: SideOrigin = "unknown";
  const rawSide = typeof raw.side === "string" ? raw.side.toLowerCase() : "";
  if (rawSide === "long" || rawSide === "short") {
    side = rawSide as "long" | "short";
    sideOrigin = "provider";
  } else if (Number.isFinite(spot) && spot > 0) {
    // nivel bajo el precio = liquidez de longs; sobre el precio = shorts
    side = price < spot ? "long" : "short";
    sideOrigin = "inferred";
  }

  return { price, notional: Number.isFinite(notional) && notional > 0 ? notional : 0, side, sideOrigin };
}

/**
 * Intenta obtener clusters externos vía proxy local.
 * Devuelve null si el proveedor no está configurado/disponible.
 */
export async function fetchExternalClusters(spot: number): Promise<ExternalClusterSet | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < RETRY_MS) return cached;
  if (tried && now - lastAttempt < RETRY_MS) return cached;

  tried = true;
  lastAttempt = now;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("http://127.0.0.1:4173/api/externalClusters", { signal: ctrl.signal });
    clearTimeout(t);

    if (!res.ok) {
      markSource("clusters_externos", "unavailable", "proxy sin proveedor configurado (COINGLASS_API_KEY / EXTERNAL_LIQUIDITY_URL)");
      return null;
    }

    const j = (await res.json()) as {
      provider?: string;
      clusters?: RawCluster[];
      error?: string;
    };

    if (j.error || !Array.isArray(j.clusters)) {
      markSource("clusters_externos", "unavailable", j.error ?? "respuesta sin clusters");
      return null;
    }

    const clusters = j.clusters
      .map((c) => toCluster(c, spot))
      .filter((c): c is ExternalCluster => c !== null);

    if (clusters.length === 0) {
      markSource("clusters_externos", "unavailable", "el proveedor devolvió 0 clusters");
      return null;
    }

    const provider = j.provider === "custom" ? "custom" : "coinglass";
    cached = {
      provider,
      clusters,
      fetchedAt: now,
      note: "clusters externos ESTIMADOS · side " + (clusters.some((c) => c.sideOrigin === "inferred") ? "parcialmente inferido" : "del proveedor"),
    };
    markSource("clusters_externos", "estimated", `${provider} · ${clusters.length} clusters (estimación externa)`);
    return cached;
  } catch {
    markSource("clusters_externos", "unavailable", "proxy local no alcanzable");
    return null;
  }
}

/** Limpia la caché (para forzar re-fetch tras configurar el .env) */
export function resetExternalClusters() {
  cached = null;
  tried = false;
  lastAttempt = 0;
}
