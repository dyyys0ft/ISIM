@echo off
title ISIM - Abrir puerto de acceso en intranet
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"

for /f "usebackq delims=" %%P in (`node server\scripts\puerto-acceso.js --port`) do set "PUERTO=%%P"

if not defined PUERTO (
  echo No se pudo leer el puerto configurado.
  pause
  exit /b 1
)

echo Abriendo el puerto %PUERTO% en el firewall de Windows...
netsh advfirewall firewall delete rule name="ISIM Acceso %PUERTO%" >nul 2>&1
netsh advfirewall firewall add rule name="ISIM Acceso %PUERTO%" dir=in action=allow protocol=TCP localport=%PUERTO% profile=private,public enable=yes >nul

echo.
echo Listo. El puerto %PUERTO% quedo habilitado para la intranet.
echo Para ver la URL completa ejecuta: node server\scripts\puerto-acceso.js
echo.
pause
