@echo off
REM Stops AI Media Workflow (API/UI server and the Vite dev server if running).
setlocal
cd /d "%~dp0"
set "APP_PORT=8787"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" if not "%%b"=="" set "APP_PORT=%%b"

set FOUND=0
for %%P in (%APP_PORT% 5173) do (
  for /f "tokens=5" %%i in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    taskkill /PID %%i /T /F >nul 2>&1
    set FOUND=1
  )
)
if "%FOUND%"=="1" (echo AI Media Workflow stopped.) else (echo AI Media Workflow is not running.)
