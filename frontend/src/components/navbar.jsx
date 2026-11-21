import { useCallback, useEffect, useRef, useState } from 'react'
import Calibration from './calibration'
import './navbar.css'
import { apiJson } from '../services/api'
  
export default function Navbar() {
  const [telemetry, setTelemetry] = useState(null)
  const [serverOnline, setServerOnline] = useState(false)
  const [vehicleConnected, setVehicleConnected] = useState(false)
  const [commandsEnabled, setCommandsEnabled] = useState(false)
  const [allowedModes, setAllowedModes] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [calOpen, setCalOpen] = useState(false)
  const noticeTimer = useRef(null)

  const showNotice = (message, duration) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = window.setTimeout(() => setNotice(''), duration)
  }

  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  useEffect(() => {
    if (!calOpen) return
    const onKey = (event) => { if (event.key === 'Escape') setCalOpen(false) }
    const onDown = (event) => {
      if (!event.target.closest('.nav-dropdown, [data-cal-toggle]')) setCalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [calOpen])

  const refresh = useCallback(async () => {
    try {
      const [health, connection, state] = await Promise.all([
        apiJson('/health'),
        apiJson('/connection/status'),
        apiJson('/telemetry'),
      ])
      setServerOnline(Boolean(health.ok))
      setCommandsEnabled(Boolean(health.commands_enabled))
      if (Array.isArray(health.allowed_flight_modes)) {
        setAllowedModes(health.allowed_flight_modes.map((mode) => String(mode).trim().toUpperCase()).filter(Boolean))
      }
      setVehicleConnected(Boolean(connection.connected))
      setTelemetry(state || null)
    } catch {
      setServerOnline(false)
      setVehicleConnected(false)
      setCommandsEnabled(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(refresh, 1500)
    return () => window.clearInterval(timer)
  }, [refresh])

  const sendCommand = async (type, payload = {}) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await apiJson('/commands', {
        method: 'POST',
        body: JSON.stringify({ type, payload }),
      })
      showNotice('Command confirmed', 3500)
      await refresh()
    } catch (error) {
      showNotice(error.message, 5000)
    } finally {
      setBusy(false)
    }
  }

  const armed = telemetry?.armed === true
  const connected = Boolean(serverOnline && vehicleConnected)
  const currentMode = telemetry?.flight_mode || ''
  const commandReady = connected && commandsEnabled && !busy
  const currentModeName = currentMode.toUpperCase()
  const isAutoland = currentModeName === 'AUTOLAND'
  const relativeAltitude = Number(telemetry?.rel_alt)
  const speed = Number(telemetry?.airspeed ?? telemetry?.air_speed ?? telemetry?.groundspeed ?? telemetry?.ground_speed)
  const airborne = armed && (telemetry?.rel_alt == null || !Number.isFinite(relativeAltitude)
    || relativeAltitude > 2 || (Number.isFinite(speed) && speed > 5))
  const canArm = commandReady && (!isAutoland || armed)
  const canDisarm = commandReady && armed && !airborne
  const canTakeoff = commandReady && armed && !isAutoland
  const modes = allowedModes.length ? allowedModes : ['STABILIZE', 'ACRO', 'MANUAL', 'FBWA', 'AUTO', 'GUIDED', 'LOITER', 'RTL', 'TAKEOFF']
  const modeIsListed = modes.includes(currentModeName)
  const unavailableReason = !serverOnline
    ? 'Server belum terhubung'
    : !vehicleConnected
      ? 'Vehicle belum terhubung'
      : !commandsEnabled
        ? 'Kontrol perintah belum diaktifkan'
        : ''

  return (
    <header className="gcs-navbar">
      <a className="brand" href="#main-map" aria-label="GCS home">
        {/* <img className="brand-logo" src={logo} alt="" /> */}
        <span className="brand-name">Ground Control Station</span>
      </a>

      <div className="nav-status" aria-label="Connection status">
        <span className="nav-status-item">
          <span className={`status-dot${serverOnline ? ' is-online' : ''}`} aria-hidden="true" />
          <span className="status-label">Server</span>
          <strong className={serverOnline ? 'status-value online' : 'status-value'}>{serverOnline ? 'ONLINE' : 'OFFLINE'}</strong>
        </span>
        <span className="nav-status-item">
          <span className={`status-dot${connected ? ' is-online' : ''}`} aria-hidden="true" />
          <span className="status-label">Vehicle</span>
          <strong className={connected ? 'status-value online' : 'status-value'}>{connected ? 'CONNECTED' : 'OFFLINE'}</strong>
        </span>
        <span className="mode-display">
          <span className="status-label">Mode</span>
          <strong>{currentMode || '—'}</strong>
        </span>
      </div>

      <button
          data-cal-toggle
          className="nav-button"
          type="button"
          disabled={!connected || !commandsEnabled || armed}
          title={armed ? 'Disarm before calibrating' : 'Sensor calibration'}
          onClick={() => setCalOpen((open) => !open)}
        >
          Calibrate
        </button>
      <div className="nav-dropdown" hidden={!calOpen}>
        <Calibration />
      </div>

      <div className="nav-controls">
        <span className={`arm-state${armed ? ' armed' : ''}`}>{armed ? 'ARMED' : 'DISARMED'}</span>
        <button
          className={`nav-button arm-button${armed ? ' is-armed' : ''}`}
          type="button"
          disabled={armed ? !canDisarm : !canArm}
          title={armed
            ? (unavailableReason || (airborne ? 'Tidak bisa disarm saat pesawat masih di udara atau ketinggian belum tersedia' : 'Disarm pesawat'))
            : (unavailableReason || (isAutoland ? 'Pilih MANUAL atau FBWA sebelum arm setelah landing' : 'Arm pesawat sebelum takeoff'))}
          onClick={() => sendCommand(armed ? 'disarm' : 'arm')}
        >
          {busy ? 'WAIT…' : armed ? 'Disarm' : 'Arm'}
        </button>
        <label className="mode-select-wrap">
          <span className="sr-only">Flight mode</span>
          <select
            className="mode-select"
            value={currentMode}
            disabled={!commandReady}
            title={commandReady ? 'Pilih mode terbang' : (unavailableReason || 'Tunggu perintah sebelumnya selesai')}
            onChange={(event) => sendCommand('set_mode', { mode: event.target.value })}
          >
            <option value="" disabled>Set mode</option>
            {!modeIsListed && currentMode && <option value={currentMode} disabled>{currentMode}</option>}
            {modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <button
          className="nav-button"
          type="button"
          disabled={!canTakeoff}
          title={unavailableReason || (isAutoland
            ? 'Pilih MANUAL atau FBWA, lalu arm sebelum takeoff'
            : (armed ? 'Takeoff' : 'Arm the vehicle before takeoff'))}
          onClick={() => sendCommand('takeoff', { altitude_m: 100 })}
        >
          Takeoff 100 m
        </button>
        <button
          className="nav-button"
          type="button"
          disabled={!commandReady || !armed}
          title={unavailableReason || (armed ? 'Land' : 'Arm pesawat sebelum menggunakan Land')}
          onClick={() => sendCommand('land')}
        >
          Land
        </button>
        <button
          className="nav-button safety-button"
          type="button"
          disabled={!commandReady || !armed}
          title={unavailableReason || (armed ? 'Return to launch' : 'Arm pesawat sebelum menggunakan RTL')}
          onClick={() => sendCommand('rtl')}
        >
          RTL
        </button>
      </div>
        {notice && <div className="nav-notice" role="status">{notice}
      </div>}
    </header>
  )
}
