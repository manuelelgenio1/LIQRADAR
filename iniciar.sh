#!/bin/bash
# LiqRadar — lanzador para Mac y Linux
# Uso: doble clic (o en terminal: ./iniciar.sh)
cd "$(dirname "$0")"

echo ""
echo "  ================================================"
echo "     LIQRADAR - Radar de Liquidaciones BTC"
echo "  ================================================"
echo ""

# 1) ¿Node.js instalado?
if ! command -v node >/dev/null 2>&1; then
    echo "  [X] Node.js NO está instalado."
    echo ""
    echo "      Mac:     abre Terminal y ejecuta:  brew install node"
    echo "               (si no tienes brew: https://brew.sh)"
    echo "      Linux:   sudo apt install nodejs npm   (o tu gestor)"
    echo "      O descarga desde: https://nodejs.org (versión LTS)"
    echo ""
    read -p "  Pulsa Enter para salir..."
    exit 1
fi
echo "  [OK] Node.js $(node -v) detectado"

# 2) Instalar dependencias (solo la primera vez)
if [ ! -d node_modules ]; then
    echo ""
    echo "  [1/2] Primera vez: instalando dependencias..."
    echo "        (tarda 1-2 minutos, solo ocurre una vez)"
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "  [X] Falló la instalación. Revisa tu conexión a internet."
        read -p "  Pulsa Enter para salir..."
        exit 1
    fi
fi

# 3) Arrancar
echo ""
echo "  [2/2] Encendiendo el radar..."
echo ""
echo "  ================================================"
echo "    El radar se abrirá solo en tu navegador."
echo "    Si no aparece, entra a: http://localhost:5173"
echo ""
echo "    Para APAGARLO: pulsa Ctrl+C en esta ventana."
echo "  ================================================"
echo ""

# abrir navegador cuando el servidor esté listo
(sleep 3; open "http://localhost:5173" 2>/dev/null || xdg-open "http://localhost:5173" 2>/dev/null) &

npm run dev
