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
