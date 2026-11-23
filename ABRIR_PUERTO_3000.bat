@echo off
title ISIM - Abrir puertos 3000 y 3443
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo Abriendo puertos HTTP 3000 y HTTPS 3443...
netsh advfirewall firewall delete rule name="ISIM HTTP 3000" >nul 2>&1
netsh advfirewall firewall add rule name="ISIM HTTP 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,public enable=yes >nul
netsh advfirewall firewall delete rule name="ISIM HTTPS 3443" >nul 2>&1
netsh advfirewall firewall add rule name="ISIM HTTPS 3443" dir=in action=allow protocol=TCP localport=3443 profile=private,public enable=yes >nul
netsh advfirewall firewall delete rule name="ISIM Consentimientos 3000" >nul 2>&1

echo.
echo Listo. Puertos 3000 y 3443 habilitados.
echo El celular debe estar en la misma red Wi-Fi.
echo.
pause