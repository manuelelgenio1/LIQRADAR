# 🧭 LiqRadar — Radar de Liquidaciones BTC

Terminal de trading que estima **dónde se acumulan las liquidaciones** de BTC, indica el **rumbo del mercado (LONG / SHORT)** y se **auto-verifica** contra datos históricos reales.

**Stack:** React 18 · TypeScript · Vite 6 · Tailwind CSS 4 · lightweight-charts

---

## 🖥️ Cómo ejecutarlo en tu PC

### 1. Requisitos previos

Instala **Node.js 18 o superior** (se recomienda la versión LTS 20+):

- Descarga: <https://nodejs.org>
- Verifica la instalación abriendo una terminal (CMD / PowerShell / Terminal):

```bash
node -v    # debe mostrar v18.x o superior
npm -v     # debe mostrar 9.x o superior
```

### 2. Descargar el proyecto

Copia la carpeta completa del proyecto a tu PC (o clona el repositorio) y abre una terminal **dentro de esa carpeta**:

```bash
cd ruta/a/liqradar
```

### 3. Instalar dependencias (solo la primera vez)

```bash
npm install
```

Esto descarga todas las librerías (tarda 1–2 minutos según tu conexión).

### 4. Ejecutar en modo desarrollo

```bash
npm run dev
```

Verás algo como:

```
VITE v6.x  ready in 500 ms
➜  Local:   http://localhost:5173/
```

Abre **http://localhost:5173/** en tu navegador (Chrome, Edge, Firefox o Brave).

> 💡 El modo desarrollo recarga solo al guardar cambios y muestra errores en pantalla.

### 5. Compilar para producción (opcional)

```bash
npm run build
```

Genera la carpeta `dist/` con la versión optimizada. Para verla localmente:

```bash
npx vite preview
```

La carpeta `dist/` es **100% estática** (HTML + JS + CSS): puedes subirla a cualquier hosting — Netlify, Vercel, GitHub Pages, o incluso abrirla con un servidor local simple.

### 6. Verificación de tipos (opcional)

```bash
npm run typecheck
```

---

## 🌐 Conexión a los datos

La herramienta consume **endpoints públicos** (no requiere API key ni cuenta):

| Fuente | Uso |
|---|---|
| `api.binance.com` | precio spot, velas, WebSocket en vivo |
| `fapi.binance.com` | funding, interés abierto, ratios L/S, takers, liquidaciones |
| `www.okx.com` / `api.bybit.com` | radar multi-exchange |

### ⚠️ ¿Binance está bloqueado en tu país?

En algunos países (EE. UU., Reino Unido, partes de Latinoamérica, etc.) los dominios de Binance pueden estar **geobloqueados**. La herramienta lo detecta sola y:

- Muestra el estado **PARCIAL** o **SIMULADO** en la barra superior (con transparencia, nunca te miente).
- Activa un **simulador coherente** para que puedas explorar toda la interfaz.
- El **diagnóstico (panel 11)** te dice exactamente qué fuente está cayendo.

Opciones si te ocurre:
1. Probar desde otra red (datos móviles, otra WiFi).
2. Usar un navegador sin extensiones bloqueadoras (algunos adblockers rompen WebSockets).
3. Desplegarlo en un hosting fuera de tu región y acceder desde ahí.

---

## 💾 Qué guarda en tu navegador

Todo se almacena localmente (`localStorage`), nunca se envía a ningún servidor:

- `liqradar-preds-v2` — historial auditado de predicciones
- `liqradar-calibration-v1` — pesos calibrados del motor
- `liqradar-hitrate-v1` — tasa de acierto del laboratorio
- preferencias de sonido, francotirador y webhook

Para empezar de cero: borra los datos del sitio desde la consola del navegador (F12 → Application → Local Storage) o usa el botón **«reiniciar»** del historial.

---

## 🧪 Cómo verificar que funciona de verdad

1. **Panel 11 · Diagnóstico en vivo**: debe mostrar **TODO OPERATIVO** (verde) si tu red llega a Binance.
2. **Panel 10 · Laboratorio**: pulsa «▶ EJECUTAR PRUEBA» → descarga ~41 días de velas reales y te da la **tasa de acierto histórica** del motor.
3. **Panel 09 · Historial**: cada veredicto se audita en vivo contra el precio real.

---

## ⚖️ Aviso importante

LiqRadar es una herramienta **estadística y educativa**. Los niveles de liquidación son **estimaciones** (como en toda la industria, incluido Coinglass). El veredicto es una probabilidad, jamás una certeza, y **no constituye asesoría financiera**. Opera con gestión de riesgo (panel 07) o no operes.
