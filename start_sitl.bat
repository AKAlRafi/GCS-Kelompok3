@echo off
setlocal

REM Run ArduPilot SITL separately so restarting the GCS does not reset the simulator.
set "ARDUPILOT_WSL=/mnt/c/Users/abdur/OneDrive/Desktop/BendaTerbang/Pelatihan/ardupilot"
set "WSL_GATEWAY=172.24.128.1"

echo Starting ArduPlane SITL. Keep this window open while using UDP mode.
wsl.exe -d ubuntu -- bash -lc "source /home/abdur/venv-ardupilot/bin/activate 2>/dev/null || true; cd '%ARDUPILOT_WSL%' && ./Tools/autotest/sim_vehicle.py -v ArduPlane --custom-location=-7.767755,110.378587,114,0 --no-extra-ports --out=%WSL_GATEWAY%:14551"

echo.
echo SITL has stopped. Press any key to close this window.
pause >nul
