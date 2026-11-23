@echo off
title ISIM - Generar certificado HTTPS
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0GENERAR_CERTIFICADO_HTTPS.ps1"
pause