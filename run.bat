@echo off
setlocal

REM Run the same startup flow as eksekusi.ps1: Redis, backend, MAVLink engine, and SITL.
set "SCRIPT=%~dp0eksekusi.ps1"

if not exist "%SCRIPT%" (
    echo [GAGAL] File eksekusi.ps1 tidak ditemukan: "%SCRIPT%"
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [GAGAL] eksekusi.ps1 berhenti dengan kode %EXIT_CODE%.
    pause
    exit /b %EXIT_CODE%
)

echo.
echo Startup selesai. 
pause
exit /b
