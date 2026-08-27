#!/usr/bin/env bash
# ============================================================
#  LiqRadar · Arrancador de un solo clic (macOS / Linux)
#  Instala dependencias (primera vez), arranca el radar y
#  abre el navegador automáticamente.
# ============================================================

set -u
cd "$(dirname "$0")"

verde="\033[1;32m"; rojo="\033[1;31m"; gris="\033[0;90m"; reset="\033[0m"

echo ""
echo "  ════════════════════════════════════════════════════"
echo "     LIQRADAR · Radar de Liquidaciones BTC"
echo "     Un solo clic: instala, arranca y abre el navegador"
echo "  ════════════════════════════════════════════════════"
echo ""

abrir() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  fi
}

# ----------------------------------------------------------
# 1) ¿Node.js instalado?
# ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo -e "  ${rojo}[X]${reset} Node.js NO está instalado en tu PC."
  echo ""
  echo "      1. Ve a https://nodejs.org"
  echo "      2. Descarga la versión LTS e instálala"
  echo "      3. Vuelve a ejecutar este script"
  echo ""
  read -rp "  Pulsa Enter para salir..." _
  exit 1
fi
echo -e "  ${verde}[OK]${reset} Node.js $(node -v) detectado"

# ----------------------------------------------------------
# 2) Instalar dependencias (solo la primera vez)
# ----------------------------------------------------------
if [ ! -d node_modules ]; then
  echo ""
  echo -e "  ${gris}[1/3]${reset} Primera vez: instalando dependencias..."
  echo "        (tarda 1-2 minutos, solo ocurre una vez)"
  echo ""
  if ! npm install --no-audit --no-fund; then
    echo ""
    echo -e "  ${rojo}[!]${reset} npm install falló. Probando modo sin dependencias..."
    if [ -f "dist/index.html" ]; then
      echo -e "  ${verde}[OK]${reset} Carpeta dist/ encontrada: modo servidor estático."
      MODO="estatico"
    else
      echo ""
      echo -e "  ${rojo}[X]${reset} Sin internet para instalar y sin carpeta dist/."
      echo "      Revisa tu conexión y vuelve a ejecutar este script."
      read -rp "  Pulsa Enter para salir..." _
      exit 1
    fi
  else
    MODO="dev"
  fi
else
  MODO="dev"
fi

# ----------------------------------------------------------
# 3) Arrancar
# ----------------------------------------------------------
if [ "${MODO:-dev}" = "estatico" ]; then
  echo ""
  echo -e "  ${gris}[3/3]${reset} Arrancando servidor estático (sin npm)..."
  echo ""
  echo "  ════════════════════════════════════════════════════"
  echo "    El radar se abrirá solo en tu navegador."
  echo "    Si no aparece, entra a: http://localhost:4173"
  echo ""
  echo "    Para APAGARLO: pulsa Ctrl+C o cierra esta terminal."
  echo "  ════════════════════════════════════════════════════"
  echo ""
  ( sleep 2; abrir "http://localhost:4173" ) &
  node server.mjs
else
  echo ""
  echo -e "  ${gris}[2/3]${reset} Encendiendo el radar..."
  echo ""
  echo "  ════════════════════════════════════════════════════"
  echo "    El radar se abrirá solo en tu navegador."
  echo "    Si no aparece, entra a: http://localhost:5173"
  echo ""
  echo "    Para APAGARLO: pulsa Ctrl+C o cierra esta terminal."
  echo "  ════════════════════════════════════════════════════"
  echo ""
  ( sleep 3; abrir "http://localhost:5173" ) &
  npm run dev
fi
