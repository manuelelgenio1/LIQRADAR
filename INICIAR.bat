@echo off
chcp 65001 >nul 2>nul
title LiqRadar - Radar de Liquidaciones BTC
color 0A
cd /d "%~dp0"

echo.
echo  ====================================================
echo     LIQRADAR - Radar de Liquidaciones BTC
echo     Un solo clic: instala, arranca y abre el navegador
echo  ====================================================
echo.

:: ----------------------------------------------------------
:: 1) ¿Node.js instalado?
:: ----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js NO esta instalado en tu PC.
    echo.
    echo      1. Ve a https://nodejs.org
    echo      2. Descarga la version LTS e instalala (siguiente, siguiente...)
    echo      3. Vuelve a hacer doble clic en este archivo
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo  [OK] Node.js %%v detectado

:: ----------------------------------------------------------
:: 2) Instalar dependencias (solo la primera vez)
:: ----------------------------------------------------------
if not exist node_modules (
    echo.
    echo  [1/3] Primera vez: instalando dependencias...
    echo        (tarda 1-2 minutos, solo ocurre una vez)
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo  [!] npm install fallo. Probando modo sin dependencias...
        if exist "dist\index.html" (
            echo  [OK] Carpeta dist\ encontrada: modo servidor estatico.
            goto MODO_ESTATICO
        ) else (
            echo.
            echo  [X] Sin internet para instalar y sin carpeta dist\.
            echo      Revisa tu conexion y vuelve a ejecutar este archivo.
            pause
            exit /b 1
        )
    )
)

:: ----------------------------------------------------------
:: 3) Arrancar en modo desarrollo
:: ----------------------------------------------------------
echo.
echo  [2/3] Encendiendo el radar...
echo.
echo  ====================================================
echo    El radar se abrira solo en tu navegador.
echo    Si no aparece, entra a: http://localhost:5173
echo.
echo    Para APAGARLO: cierra esta ventana negra.
echo  ====================================================
echo.

:: abrir navegador cuando el servidor este listo
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"

call npm run dev
pause
exit /b 0

:MODO_ESTATICO
echo.
echo  [3/3] Arrancando servidor estatico (sin npm)...
echo.
echo  ====================================================
echo    El radar se abrira solo en tu navegador.
echo    Si no aparece, entra a: http://localhost:4173
echo.
echo    Para APAGARLO: cierra esta ventana negra.
echo  ====================================================
echo.
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4173"
node server.mjs
pause
exit /b 0
