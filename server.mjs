/* ============================================================
   LiqRadar · Servidor estático de emergencia (cero dependencias)
   Sirve la carpeta dist/ con Node.js puro. Se usa cuando
   `npm install` no está disponible: con Node + dist/ basta.
   Uso: node server.mjs   (http://localhost:4173)
   ============================================================ */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", "dist"));
const PORT = 4173;

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
