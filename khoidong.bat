@echo off
REM AI Media Workflow - bam dup de chay. Lan dau se tu tai Node.js va thu vien (can Internet).
cd /d "%~dp0"
title AI Media Workflow
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\khoidong.ps1"
if errorlevel 1 (
  echo.
  pause
)
