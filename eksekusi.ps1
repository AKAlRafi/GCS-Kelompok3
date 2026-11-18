param(
  [string]$ConnectionMode = '',
  [string]$SerialPort = '',
  [ValidateRange(0, 3000000)]
  [int]$BaudRate = 0,
  [switch]$EnableCommands
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ConnectionMode)) {
  Write-Host ''
  Write-Host 'Pilih sumber MAVLink:' -ForegroundColor Cyan
  Write-Host '  1. UDP (SITL dijalankan terpisah)'
  Write-Host '  2. Flight Controller via USB'

  switch ((Read-Host 'Pilihan [1/2]').Trim()) {
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
$serialPortTool = Join-Path $projectRoot 'serial_port_tool.py'

if (-not (Test-Path $enginePython)) {
  throw 'Python engine belum siap. Pasang requirements di backend\mavlink_engine terlebih dahulu.'
}

if (-not (Test-Path (Join-Path $backendRoot 'node_modules'))) {
  throw 'Backend belum siap. Jalankan npm install di backend\server terlebih dahulu.'
}

if ($ConnectionMode -eq 'USB') {
  $portOutput = & $enginePython $serialPortTool list 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'Gagal membaca port aktif. Pastikan pyserial sudah terpasang di backend/mavlink_engine/.venv.'
  }

  $portEntries = @(
    foreach ($line in $portOutput) {
      $parts = $line -split "`t", 2
      if ($parts[0].Trim() -match '^COM\d+$') {
        $description = if ($parts.Count -gt 1) { $parts[1].Trim() } else { 'Serial device' }
        [pscustomobject]@{
          Port = $parts[0].Trim()
          Description = $description
        }
      }
    }
  ) | Sort-Object Port

  if ($portEntries.Count -eq 0) {
    throw 'Tidak ada port serial aktif yang terdeteksi. Port abu-abu di Device Manager adalah perangkat lama yang sedang tidak tersambung.'
  }

  if ([string]::IsNullOrWhiteSpace($SerialPort)) {
    Write-Host ''
    Write-Host 'Port serial aktif yang terdeteksi:' -ForegroundColor Cyan
    for ($index = 0; $index -lt $portEntries.Count; $index++) {
      Write-Host ('  {0}. {1} - {2}' -f ($index + 1), $portEntries[$index].Port, $portEntries[$index].Description)
    }

    if ($portEntries.Count -eq 1) {
      $SerialPort = $portEntries[0].Port
      Write-Host "Menggunakan $SerialPort."
    } else {
      $selection = Read-Host 'Pilih nomor port FC'
      $portIndex = 0
      if (-not [int]::TryParse($selection, [ref]$portIndex) -or $portIndex -lt 1 -or $portIndex -gt $portEntries.Count) {
        throw 'Pilihan port tidak valid.'
      }
      $SerialPort = $portEntries[$portIndex - 1].Port
    }
  }

  $selectedPort = $portEntries | Where-Object Port -eq $SerialPort | Select-Object -First 1
  if (-not $selectedPort) {
    $availablePorts = ($portEntries | ForEach-Object Port) -join ', '
    throw "Port $SerialPort tidak terdeteksi. Port yang tersedia: $availablePorts. Periksa kabel data dan driver FC."
  }

  if ($selectedPort.Description -match 'Bluetooth') {
    Write-Warning "$SerialPort adalah port Bluetooth ($($selectedPort.Description)), bukan USB-SERIAL CH340. Pastikan radio telemetri memang terhubung lewat port Bluetooth ini."
  }

  if ($BaudRate -le 0) {
    Write-Host "Mendeteksi baud rate pada $SerialPort (menunggu heartbeat MAVLink)..."
    $probeOutput = & $enginePython $serialPortTool probe $SerialPort 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw 'Probe baud rate gagal. Pastikan pymavlink dan pyserial terpasang di backend/mavlink_engine/.venv.'
    }

    $detectedBaud = $probeOutput | Select-Object -Last 1
    if ($null -eq $detectedBaud -or $detectedBaud.ToString().Trim() -notmatch '^\d+$') {
      throw "Tidak menerima heartbeat MAVLink di $SerialPort pada baud rate umum. Periksa port FC, aplikasi lain yang memakai port, dan koneksi telemetri."
    }

    $BaudRate = [int]$detectedBaud.ToString().Trim()
    Write-Host "Baud rate terdeteksi: $BaudRate" -ForegroundColor Green
  }
}

$mavlinkUrl = if ($ConnectionMode -eq 'USB') {
  "serial:$SerialPort`:$BaudRate"
} else {
  'udpin:0.0.0.0:14551'
}

Write-Host 'Menyalakan Redis di WSL...'
$hadNativeErrorPreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
$previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
$PSNativeCommandUseErrorActionPreference = $false
try {
  $redisOutput = & wsl.exe -d ubuntu -u root -- service redis-server start 2>&1
  $redisExitCode = $LASTEXITCODE
} finally {
  if ($hadNativeErrorPreference) {
    $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
  } else {
    Remove-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  }
}

if ($redisOutput) {
  $redisOutput | ForEach-Object { Write-Host $_ }
}
if ($redisOutput -match "Unknown key 'memory'") {
  Write-Warning 'Redis tetap dicoba, tapi .wslconfig perlu bagian [wsl2] sebelum baris memory=2GB.'
}
if ($redisExitCode -ne 0) {
  throw 'Redis gagal dinyalakan di WSL Ubuntu. Pastikan distro Ubuntu dan paket redis-server tersedia.'
}

$redisReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $tcpClient = [System.Net.Sockets.TcpClient]::new()
  try {
    $connectAttempt = $tcpClient.BeginConnect('127.0.0.1', 6379, $null, $null)
    if ($connectAttempt.AsyncWaitHandle.WaitOne(200, $false)) {
      $tcpClient.EndConnect($connectAttempt)
      $redisReady = $true
      break
    }
  } catch {
    # Redis bisa butuh waktu sebentar untuk mulai.
  } finally {
    $tcpClient.Dispose()
  }

  if ($attempt -lt 19) {
    Start-Sleep -Milliseconds 250
  }
}

if (-not $redisReady) {
  throw 'Redis sudah diminta untuk menyala, tetapi 127.0.0.1:6379 belum bisa diakses. Backend dan MAVLink engine tidak dijalankan.'
}
Write-Host 'Redis siap di 127.0.0.1:6379.' -ForegroundColor Green

$commandFlag = if ($ConnectionMode -eq 'SITL' -or $EnableCommands) { '1' } else { '0' }
$env:MAVLINK_URL = $mavlinkUrl
$env:ENABLE_COMMANDS = $commandFlag
$env:COMMANDS_READY = $commandFlag
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', 'npm start') -WorkingDirectory $backendRoot -WindowStyle Normal

$env:REDIS_HOST = '127.0.0.1'
$env:REDIS_PORT = '6379'
$env:REDIS_CHANNEL = 'telemetry'
$env:REDIS_COMMAND_CHANNEL = 'commands'
$env:REDIS_ACK_CHANNEL = 'command_acks'
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', "& '.\.venv\Scripts\python.exe' -m mavlink_engine.main") -WorkingDirectory $engineRoot -WindowStyle Normal

Write-Host "Redis, backend, dan MAVLink engine dijalankan. Koneksi: $mavlinkUrl"
if ($ConnectionMode -eq 'SITL') {
  Write-Host 'Pastikan start_sitl.bat sudah dijalankan. SITL tidak dimulai ulang oleh skrip ini.'
  Write-Host 'Perintah GCS aktif untuk SITL.' -ForegroundColor Green
} elseif (-not $EnableCommands) {
  Write-Host 'Perintah ARM/gerak dinonaktifkan untuk pemeriksaan awal. Telemetri tetap aktif.'
  Write-Host 'Pastikan propeler dilepas. Untuk mengaktifkan perintah, jalankan ulang dengan -EnableCommands.'
  Write-Warning 'Tutup aplikasi lain yang sedang memakai port serial FC.'
} else {
  Write-Warning 'Perintah drone AKTIF. Pastikan area aman, propeler dilepas saat pengujian meja, dan operator berwenang mengendalikan FC.'
}
