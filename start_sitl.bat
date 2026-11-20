@echo off
setlocal

set "ARDUPILOT_WSL=/home/faishal_pradana/ardupilot"
set "WSL_GATEWAY=127.0.0.1"

echo Starting ArduPlane SITL. Keep this window open while using UDP mode.
wsl.exe -- bash -lc "source /home/faishal_pradana/venv-ardupilot/bin/activate 2>/dev/null || true; cd '%ARDUPILOT_WSL%' && ./Tools/autotest/sim_vehicle.py -v ArduPlane --custom-location=-7.767755,110.378587,114,0 --no-extra-ports --out=%WSL_GATEWAY%:14551"

echo.
echo SITL has stopped. Press any key to close this window.
pause >nul