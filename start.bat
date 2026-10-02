@echo off
REM AI Media Workflow - start on Windows 10/11.
REM Installs dependencies on first run, prepares the database, builds the UI and starts the server.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.19 or newer is required. Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist ".env" if exist ".env.example" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example - add your API keys there ^(optional^).
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run, this can take a few minutes^)...
  call npm install
  if errorlevel 1 goto :failed
)

echo Preparing database...
call npm run setup
if errorlevel 1 goto :failed

echo Building the web interface...
call npm run build
if errorlevel 1 goto :failed

set "APP_PORT=8787"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" if not "%%b"=="" set "APP_PORT=%%b"

echo.
echo AI Media Workflow is starting on http://127.0.0.1:%APP_PORT%
echo Close this window or run stop.bat to stop it.
echo.
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://127.0.0.1:%APP_PORT%"
call npm run start -w backend
exit /b %errorlevel%

:failed
echo.
echo Start failed. See the messages above.
pause
exit /b 1
