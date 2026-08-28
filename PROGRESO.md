# LIQRADAR · Registro de progreso

> Este archivo es el mapa de ruta vivo del proyecto. Se actualiza al terminar cada bloque de trabajo.
> Última actualización: sesión actual.

---

## 📍 ESTADO ACTUAL

**Build:** ✅ limpio (95 módulos, 0 errores de tipos)
**Fases del handoff V5:** 1 ✅ · 2 ✅ · 3 ✅ · 4 ✅
**Último bloque completado:** Fixes de alineación post-temporalidades + alertas por absorción

---

## ✅ COMPLETADO (acumulado)

### Núcleo del motor
- [x] Mapa de liquidación estimado (velas + apalancamiento + OI), MMR real por tier
- [x] 20+ factores en dos escuelas (contrarian + impulso) con compuerta de régimen
- [x] Dirección anclada en el imán de liquidez (liquidityPull, ponderada por cercanía)
- [x] Market Regime state-first como guardia de dirección (TREND/RANGE/COMPRESSION/EXPANSION/CHOP)
- [x] OI regimes (LONG/SHORT BUILD/UNWIND, NEUTRAL)
- [x] Absorción avanzada + riesgo spoof/pull (nunca "confirmado")
- [x] Validación `Number.isFinite()` + bloqueo de señal sin datos críticos
- [x] Convención LONG=dirección alcista / SHORT=dirección bajista en toda la UI

### Datos REALES (V5)
- [x] CVD real Spot + Futuros vía `aggTrade` (sustituye al derivado de velas)
- [x] Libro L2 secuenciado (snapshot REST + diff-depth WS con verificación U/u/pu + resync)
- [x] Top-Trader Position Flow (delta/z-score, sin lenguaje "ballenas")
- [x] Opciones: put/call, IV ATM, skew 25Δ, Max Pain (aproximaciones declaradas)
- [x] Cross-exchange: Binance + OKX + Bybit (precio, funding, OI) + heatmap de funding
- [x] Brackets reales vía proxy local firmado (HMAC, clave nunca sale del servidor)
- [x] Clusters externos CoinGlass/endpoint personalizado (opcionales, marcados ESTIMATED)
- [x] Panel Data Truth (REAL / ESTIMADO / SIN DATOS por fuente)

### Validación y transparencia
- [x] Backtest walk-forward con split TRAIN 60% / OOS 40% (la calibración jamás toca el OOS)
- [x] Scorecard de precisión por factor (solo TRAIN)
- [x] Índice de confiabilidad que usa el OOS
- [x] Track record en vivo de predicciones + exportación CSV
- [x] Registro de auditoría con capturadores globales de errores
- [x] REAL ONLY: la señal se bloquea a NEUTRAL si los datos críticos son sintéticos

### Experiencia
- [x] 5 zonas plegables + mini-nav con scroll-spy
- [x] Rumbo (dial), régimen, confluencia MTF, alertas (giro/imán/francotirador/niveles/webhook/sonido)
- [x] Agente paper trading, puente Agent OS (MCP), diario de trading, gestión de riesgo
- [x] Temporalidades: **15m / 1h / 4h / 1D / 1W** (confluencia en 1h/4h/1d)
- [x] Arranque 1 clic (INICIAR.bat / iniciar.sh / server.mjs / Netlify Drop)

---

## 🔧 EN CURSO / PRÓXIMOS BLOQUES (en orden)

### Bloque actual: Historia de microestructura
- [x] Temporalidades reestructuradas (15m/1h/4h/1D/1W, defecto 4h)
- [x] Confluencia MTF alineada (1h/4h/1d)
- [x] **Heatmap L2 histórico** (canvas tiempo×precio con la captura real) — panel 06d
- [x] Indicador "captura desde" honesto (la historia empieza al abrir la app, no se inventa pasado)

### Fixes de alineación post-temporalidades (detectados en revisión)
- [x] **Signo del factor "barrida"** — estaba invertido: decía "combustible gastado" pero sumaba a favor del movimiento. Ahora `score = −sweep` (rechazo = reversión). Bug de lógica real.
- [x] **Ventana temporal acotada por TF** — el tope estaba fijo en 96h; en 1D/1W daba "2–96h" para objetivos a semanas. Ahora cada TF define su tope (`winH`: 15m→48h … 1w→2160h).
- [x] **Umbral de cascadas** — era 1 ATR horario (~0.15% en 15M), casi nunca se activaba en TFs cortos. Ahora `max(ATR, 0.25%)`.
- [x] **Eje temporal del gráfico** — mostraba horas (00:00) en velas 1D/1W. Ahora alterna fechas/horas según la categoría del TF.
- [x] **Nota de confluencia** — aclarado que 1h/4h/1d son horizontes de confirmación fijos (no siguen al TF del gráfico).

### Cola de mejoras pendientes (en orden)
1. [x] **Alertas por absorción** — toast + sonido + webhook cuando fuerza ≥50% (1/min). `bid`=alcista · `ask`=bajista
2. [ ] **Replay de microestructura** ← *siguiente* (rebobinar el libro + trades + liquidaciones capturados)
3. [ ] Selector de ventana en el heatmap de funding (3d/7d/14d)
4. [ ] Modo pantalla completa del rumbo (para segundo monitor)
5. [ ] Documentar el protocolo del endpoint JSON de clusters externos en el README
6. [ ] ~~Code-splitting~~ **DIFERIDO**: no se puede editar vite.config.ts en este entorno (restricción) y React.lazy rompería la apertura vía `file://`. El bundle de ~640 KB (gzip 195 KB) es aceptable para una SPA de este alcance.

---

## 📐 Reglas que rigen cada cambio (del handoff V5)

1. LONG = movimiento alcista; SHORT = movimiento bajista. Squeeze = mecanismo, no señal.
2. Liquidaciones ejecutadas = observado; clusters futuros = estimación (siempre etiquetado).
3. HTTP 200 ≠ dato válido → todo pasa por `Number.isFinite()`.
4. Modo REAL nunca fabrica datos: si falta algo crítico, la señal se bloquea (NEUTRAL).
5. Nunca API keys en frontend/bundle → `.env` + servidor local.
6. "Top-Trader Position Flow", jamás "whale positions" sin datos de ballenas reales.
7. La microestructura histórica solo existe desde que arranca la captura.
8. La confianza se calibra con datos fuera de muestra.
