@echo off
title Sistema Medico ISIM
cd /d "%~dp0"
python server.py
if errorlevel 1 py server.py
pause
