@echo off
title ISIM - Sistema de Consentimientos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No se encontro Node.js.
  echo Instala Node.js 24 desde https://nodejs.org y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo Iniciando el sistema...
echo Computadora (HTTPS): https://127.0.0.1:3443
echo Computadora (HTTP):  http://127.0.0.1:3000
echo Celular (QR):        http://IP-DEL-EQUIPO:3000
echo Para detenerlo: cierra esta ventana o presiona Ctrl+C.
echo.
echo Opcional: ejecuta GENERAR_CERTIFICADO_HTTPS.bat para HTTPS en la PC.
echo Firewall: ejecuta ABRIR_PUERTO_3000.bat como administrador.
echo Intranet: elige el puerto y las IPs permitidas en Ajustes ^> Red / Acceso.
echo           luego ejecuta ABRIR_PUERTO_RED.bat como administrador.
echo.

node server/index.js
pause