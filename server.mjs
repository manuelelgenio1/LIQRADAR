/* ============================================================
   LiqRadar · Servidor estático de emergencia (cero dependencias)
   Sirve la carpeta dist/ con Node.js puro. Se usa cuando
   `npm install` no está disponible: con Node + dist/ basta.
   Uso: node server.mjs   (http://localhost:4173)
   ============================================================ */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", "dist"));
const PORT = 4173;
const ENV_PATH = resolve(join(fileURLToPath(import.meta.url), "..", ".env"));

/* Lee .env local (KEY=valor). La clave NUNCA sale del proceso del servidor. */
function loadEnv() {
  const env = {};
  try {
    if (existsSync(ENV_PATH)) {
      for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* sin .env */
  }
  return env;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* Brackets REALES de Binance (requiere key SOLO-LECTURA en .env) */
async function handleLeverageBracket(res) {
  const env = loadEnv();
  const key = env.BINANCE_API_KEY;
  const secret = env.BINANCE_API_SECRET;
  if (!key || !secret) {
    res.writeHead(501, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "sin clave en .env", hint: "añade BINANCE_API_KEY y BINANCE_API_SECRET (solo lectura)" }));
  }
  try {
    const qs = `symbol=BTCUSDT&timestamp=${Date.now()}&recvWindow=5000`;
    const signature = createHmac("sha256", secret).update(qs).digest("hex");
    const r = await fetch(`https://fapi.binance.com/fapi/v1/leverageBracket?${qs}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": key },
    });
    if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
    const data = await r.json();
    const br = Array.isArray(data) ? data.find((x) => x.symbol === "BTCUSDT") : data;
    const brackets = (br?.brackets ?? []).map((b) => ({
      ceiling: Number(b.notionalCap ?? b.cap ?? 0),
      mmr: Number(b.maintMarginRatio ?? b.mmr ?? 0),
      maxLeverage: Number(b.initialLeverage ?? b.leverage ?? 0),
    }));
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ brackets }));
  } catch (e) {
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message ?? "fallo consultando Binance" }));
  }
}

/* Clusters de liquidación externos (CoinGlass v4 o endpoint JSON personalizado).
   Las credenciales viven SOLO en el .env del servidor. Los clusters se devuelven
   tal cual: el frontend los marca como ESTIMADOS, nunca como posiciones observadas. */
async function handleExternalClusters(res) {
  const env = loadEnv();
  const provider = (env.EXTERNAL_LIQUIDITY_PROVIDER || "").toLowerCase();
  const customUrl = env.EXTERNAL_LIQUIDITY_URL || "";
  const cgKey = env.COINGLASS_API_KEY || "";

  try {
    let clusters = [];
    let usedProvider = "";

    if (provider === "coinglass" && cgKey) {
      usedProvider = "coinglass";
      const r = await fetch(
        "https://open-api-v4.coinglass.com/api/futures/liquidation/v2/home?symbol=BTC&timeType=h1",
        { headers: { accept: "application/json", CG_API_KEY: cgKey } }
      );
      if (!r.ok) throw new Error(`CoinGlass HTTP ${r.status}`);
      const j = await r.json();
      const list = j?.data?.liquidationData ?? j?.data ?? [];
      clusters = Array.isArray(list)
        ? list.map((x) => ({
            price: Number(x.price ?? x.srPrice ?? x.p ?? 0),
            notional: Number(x.sumOpenInterest ?? x.volUsd ?? x.amount ?? 0),
            side: typeof x.side === "string" ? x.side : undefined,
          }))
        : [];
    } else if (customUrl) {
      usedProvider = "custom";
      const headers = { accept: "application/json" };
      if (env.EXTERNAL_LIQUIDITY_TOKEN) headers["Authorization"] = `Bearer ${env.EXTERNAL_LIQUIDITY_TOKEN}`;
      const r = await fetch(customUrl, { headers });
      if (!r.ok) throw new Error(`endpoint HTTP ${r.status}`);
      const j = await r.json();
      const list = Array.isArray(j) ? j : j?.clusters ?? j?.data ?? [];
      clusters = Array.isArray(list)
        ? list.map((x) => ({
            price: Number(x.price ?? x.p ?? 0),
            notional: Number(x.notional ?? x.amount ?? x.volUsd ?? 0),
            side: typeof x.side === "string" ? x.side : undefined,
          }))
        : [];
    } else {
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          error:
            "sin proveedor configurado: define COINGLASS_API_KEY (con EXTERNAL_LIQUIDITY_PROVIDER=coinglass) o EXTERNAL_LIQUIDITY_URL en .env",
        })
      );
    }

    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ provider: usedProvider, clusters }));
  } catch (e) {
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message ?? "fallo consultando proveedor externo" }));
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error("╔══════════════════════════════════════════════════╗");
  console.error("║  ERROR: no se encontró la carpeta dist/          ║");
  console.error("║                                                  ║");
  console.error("║  Ejecuta primero:  npm run build                 ║");
  console.error("║  o descarga el proyecto completo.                ║");
  console.error("╚══════════════════════════════════════════════════╝");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

    // API local: brackets reales (firma la petición, la clave no sale del servidor)
    if (urlPath === "/api/leverageBracket") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS);
        return res.end();
      }
      return await handleLeverageBracket(res);
    }

    // API local: clusters de liquidación externos (CoinGlass / endpoint personalizado)
    if (urlPath === "/api/externalClusters") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS);
        return res.end();
      }
      return await handleExternalClusters(res);
    }

    let filePath = normalize(join(ROOT, urlPath));

    // seguridad: no salir de dist/
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    if (!existsSync(filePath) || urlPath === "/") {
      // SPA fallback → index.html
      filePath = join(ROOT, "index.html");
    }

    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end("Error interno");
  }
});

server.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════");
  console.log("  LIQRADAR · servidor local (sin dependencias)");
  console.log("───────────────────────────────────────────────────");
  console.log(`  ➜  Abre en tu navegador:  http://localhost:${PORT}`);
  console.log("  ➜  Para apagarlo:  cierra esta ventana / Ctrl+C");
  console.log("═══════════════════════════════════════════════════");
});
