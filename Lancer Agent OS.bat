@echo off
title Agent OS
rem ─── Lance le serveur Agent OS et ouvre le navigateur ───
cd /d "%~dp0agent-os"

rem Si le serveur tourne deja, on ouvre juste la page
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4100/api/health) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:4100
  echo Agent OS tourne deja - page ouverte.
  timeout /t 2 >nul
  exit /b
)

rem Ouvre le navigateur apres 2 s, puis demarre le serveur (fenetre = logs, fermer = arreter)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:4100"
echo Demarrage d'Agent OS... (fermer cette fenetre arrete le serveur)
node server.js
pause
