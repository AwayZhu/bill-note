@echo off
title Money App - Preview
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Python not found on this computer.
  echo.
  echo   1. Go to  https://www.python.org
  echo   2. Download Python 3
  echo   3. IMPORTANT: check "Add python.exe to PATH" before install
  echo.
  pause
  exit /b 1
)

chcp 65001 >nul 2>nul
cls
echo.
echo   ==========================================
echo      Personal Money App  -  Preview Server
echo   ==========================================
echo.
echo   The app will open in your browser shortly.
echo   To stop the server, press Ctrl+C here.
echo.
echo   ------------------------------------------
echo.

python "%~dp0serve.py" --lan

echo.
echo   Server stopped.
pause
