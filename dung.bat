@echo off
REM Tat AI Media Workflow (server va Vite dev server neu dang chay).
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
if "%FOUND%"=="1" (echo Da tat AI Media Workflow.) else (echo AI Media Workflow khong chay.)
timeout /t 3 >nul
