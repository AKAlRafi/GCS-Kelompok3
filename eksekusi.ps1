$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Join-Path $projectRoot 'backend\server'
$engineRoot = Join-Path $projectRoot 'backend\mavlink_engine'
$enginePython = Join-Path $engineRoot '.venv\Scripts\python.exe'
$ardupilotWsl = '/mnt/c/Users/abdur/OneDrive/Desktop/BendaTerbang/Pelatihan/ardupilot'

if (-not (Test-Path $enginePython)) {
  throw "Python engine belum siap. Pasang requirements di backend\mavlink_engine terlebih dahulu."
}
if (-not (Test-Path (Join-Path $backendRoot 'node_modules'))) {
  throw "Backend belum siap. Jalankan npm install di backend\server terlebih dahulu."
}

$gateway = '172.24.128.1'
if (-not (Test-Path 'C:\Users\abdur\OneDrive\Desktop\BendaTerbang\Pelatihan\ardupilot\Tools\autotest\sim_vehicle.py')) {
  throw 'Folder ArduPilot tidak ditemukan di lokasi yang diharapkan.'
}

# Start Redis in a persistent console. sudo may ask for the Ubuntu password.
$redisWslCommand = 'wsl.exe -d ubuntu -- bash -lc "sudo service redis-server start; exec bash -i"'
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $redisWslCommand) -WindowStyle Normal

$backendCommand = "Set-Location -LiteralPath '$backendRoot'; npm start"
Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoExit -Command `"$backendCommand`"" -WindowStyle Normal

$engineCommand = "Set-Location -LiteralPath '$engineRoot'; `$env:REDIS_HOST='127.0.0.1'; `$env:REDIS_PORT='6379'; `$env:REDIS_CHANNEL='telemetry'; `$env:REDIS_COMMAND_CHANNEL='commands'; `$env:REDIS_ACK_CHANNEL='command_acks'; `$env:MAVLINK_URL='udpin:0.0.0.0:14551'; `$env:ENABLE_COMMANDS='1'; & '.\.venv\Scripts\python.exe' -m mavlink_engine.main"
Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoExit -Command `"$engineCommand`"" -WindowStyle Normal

$sitlCommand = "source /home/abdur/venv-ardupilot/bin/activate 2>/dev/null || true; cd '$ardupilotWsl' && ./Tools/autotest/sim_vehicle.py -v ArduPlane --custom-location=-7.767755,110.378587,114,0 --no-extra-ports --out=${gateway}:14551"
$sitlCommand
$sitlWslCommand = "wsl.exe -d ubuntu -- bash -lc `"$sitlCommand`""
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $sitlWslCommand) -WindowStyle Normal

Write-Host 'Redis, backend, MAVLink engine, dan SITL sudah diminta untuk berjalan di jendela terpisah.'
Write-Host "SITL mengirim MAVLink dari WSL2 ke Windows melalui ${gateway}:14551."
Write-Host 'Tunggu build SITL selesai. Jika Ubuntu meminta password sudo, masukkan di jendela Redis.'
