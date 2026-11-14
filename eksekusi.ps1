param(
  [string]$ConnectionMode = '',

  [string]$SerialPort = '',

  [ValidateRange(1200, 3000000)]
  [int]$BaudRate = 115200,

  [switch]$EnableCommands
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ConnectionMode)) {
  Write-Host ''
  Write-Host 'Pilih sumber MAVLink:' -ForegroundColor Cyan
  Write-Host '  1. UDP / SITL'
  Write-Host '  2. Flight Controller via USB'
  $selection = Read-Host 'Pilihan [1/2]'
  switch ($selection.Trim()) {
    '1' { $ConnectionMode = 'SITL' }
    '2' { $ConnectionMode = 'USB' }
    default { throw 'Pilihan tidak valid. Jalankan ulang lalu pilih 1 atau 2.' }
  }
}

if ($ConnectionMode -notin @('SITL', 'USB')) {
  throw 'ConnectionMode harus SITL atau USB.'
}

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
if ($ConnectionMode -eq 'SITL' -and -not (Test-Path 'C:\Users\abdur\OneDrive\Desktop\BendaTerbang\Pelatihan\ardupilot\Tools\autotest\sim_vehicle.py')) {
  throw 'Folder ArduPilot tidak ditemukan di lokasi yang diharapkan.'
}
if ($ConnectionMode -eq 'USB') {
  $availablePorts = [System.IO.Ports.SerialPort]::GetPortNames()
  if ([string]::IsNullOrWhiteSpace($SerialPort)) {
    if ($availablePorts.Count -eq 0) {
      throw 'Tidak ada port COM yang terdeteksi. Sambungkan FC dengan kabel data dan periksa driver USB.'
    }
    Write-Host ''
    Write-Host 'Port serial yang terdeteksi:' -ForegroundColor Cyan
    $availablePorts = @($availablePorts | Sort-Object)
    for ($index = 0; $index -lt $availablePorts.Count; $index++) {
      Write-Host "  $($index + 1). $($availablePorts[$index])"
    }
    if ($availablePorts.Count -eq 1) {
      $SerialPort = $availablePorts[0]
      Write-Host "Menggunakan $SerialPort."
    } else {
      $portSelection = Read-Host 'Pilih nomor port FC'
      $portIndex = 0
      if (-not [int]::TryParse($portSelection, [ref]$portIndex) -or $portIndex -lt 1 -or $portIndex -gt $availablePorts.Count) {
        throw 'Pilihan port tidak valid.'
      }
      $SerialPort = $availablePorts[$portIndex - 1]
    }
  }
  if ($SerialPort -notin $availablePorts) {
    $portList = if ($availablePorts.Count) { $availablePorts -join ', ' } else { 'tidak ada' }
    throw "Port $SerialPort tidak terdeteksi. Port yang tersedia: $portList. Periksa kabel data dan driver FC."
  }
}

$mavlinkUrl = if ($ConnectionMode -eq 'USB') { "serial:$SerialPort`:$BaudRate" } else { 'udpin:0.0.0.0:14551' }

# Start Redis in a persistent console. sudo may ask for the Ubuntu password.
$redisWslCommand = 'wsl.exe -d ubuntu -- bash -lc "sudo service redis-server start; exec bash -i"'
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $redisWslCommand) -WindowStyle Normal

$backendCommand = "Set-Location -LiteralPath '$backendRoot';"
if ($ConnectionMode -eq 'USB') {
  $commandFlag = if ($EnableCommands) { '1' } else { '0' }
  $backendCommand += " `$env:MAVLINK_URL='$mavlinkUrl'; `$env:ENABLE_COMMANDS='$commandFlag'; `$env:COMMANDS_READY='$commandFlag';"
}
$backendCommand += ' npm start'
Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoExit -Command `"$backendCommand`"" -WindowStyle Normal

$engineCommands = if ($ConnectionMode -eq 'USB' -and -not $EnableCommands) { '0' } else { '1' }
$engineCommand = "Set-Location -LiteralPath '$engineRoot'; 
`$env:REDIS_HOST='127.0.0.1'; 
`$env:REDIS_PORT='6379'; 
`$env:REDIS_CHANNEL='telemetry'; 
`$env:REDIS_COMMAND_CHANNEL='commands'; 
`$env:REDIS_ACK_CHANNEL='command_acks'; 
`$env:MAVLINK_URL='$mavlinkUrl'; 
`$env:ENABLE_COMMANDS='$engineCommands'; & 
'.\.venv\Scripts\python.exe' -m mavlink_engine.main"
Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoExit -Command `"$engineCommand`"" -WindowStyle Normal

if ($ConnectionMode -eq 'SITL') {
  $sitlCommand = "source /home/abdur/venv-ardupilot/bin/activate 2>/dev/null || true; cd '$ardupilotWsl' && ./Tools/autotest/sim_vehicle.py -v ArduPlane --custom-location=-7.767755,110.378587,114,0 --no-extra-ports --out=${gateway}:14551"
  $sitlWslCommand = "wsl.exe -d ubuntu -- bash -lc `"$sitlCommand`""
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $sitlWslCommand) -WindowStyle Normal
  Write-Host 'Redis, backend, MAVLink engine, dan SITL dijalankan di jendela terpisah.'
  Write-Host "SITL mengirim MAVLink dari WSL2 ke Windows melalui ${gateway}:14551."
  Write-Host 'Tunggu build SITL selesai. Jika Ubuntu meminta password sudo, masukkan di jendela Redis.'
} else {
  Write-Host "Redis, backend, dan MAVLink engine dijalankan. Koneksi FC: $mavlinkUrl"
  if (-not $EnableCommands) {
    Write-Host 'Perintah ARM/gerak dinonaktifkan untuk pemeriksaan awal. Telemetri tetap aktif.'
    Write-Host 'Pastikan propeler dilepas. Untuk mengaktifkan perintah, jalankan ulang dengan -EnableCommands.'
  } else {
    Write-Warning 'Perintah drone AKTIF. Pastikan area aman, propeler dilepas saat pengujian meja, dan operator berwenang mengendalikan FC.'
  }
  Write-Warning 'Mode USB tidak menjalankan SITL. Tutup aplikasi lain yang sedang memakai port serial FC.'
}
