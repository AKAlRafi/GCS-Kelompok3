import { useCallback, useEffect, useState } from 'react'
import './navbar.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api').replace(/\/$/, '')
const API_TOKEN = import.meta.env.VITE_API_TOKEN || ''
const MODE_OPTIONS = (import.meta.env.VITE_ALLOWED_FLIGHT_MODES || 'STABILIZE,ACRO,ALT_HOLD,AUTO,GUIDED,LOITER,RTL,FBWA,MANUAL')
  .split(',').map((mode) => mode.trim().toUpperCase()).filter((mode) => mode && mode !== 'TAKEOFF')

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

export default function Navbar() {
  const [telemetry, setTelemetry] = useState(null)
  const [serverOnline, setServerOnline] = useState(false)
  const [vehicleConnected, setVehicleConnected] = useState(false)
  const [commandsEnabled, setCommandsEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [health, connection, state] = await Promise.all([
        requestJson('/health'),
        requestJson('/connection/status'),
        requestJson('/telemetry'),
      ])
      setServerOnline(Boolean(health.ok))
      setCommandsEnabled(Boolean(health.commands_enabled))
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
    setBusy(true)
    setNotice('')
    try {
      await requestJson('/commands', {
        method: 'POST',
        body: JSON.stringify({ type, payload }),
      })
      setNotice('Command sent')
      window.setTimeout(() => setNotice(''), 3500)
      refresh()
    } catch (error) {
      setNotice(error.message)
      window.setTimeout(() => setNotice(''), 5000)
    } finally {
      setBusy(false)
    }
  }

  const armed = telemetry?.armed === true
  const connected = Boolean(serverOnline && vehicleConnected)
  const currentMode = telemetry?.flight_mode || ''

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

      <div className="nav-controls">
        <span className={`arm-state${armed ? ' armed' : ''}`}>{armed ? 'ARMED' : 'DISARMED'}</span>
        <button
          className={`nav-button arm-button${armed ? ' is-armed' : ''}`}
          type="button"
          disabled={!connected || !commandsEnabled || busy}
          onClick={() => sendCommand(armed ? 'disarm' : 'arm')}
        >
          {busy ? 'WAIT…' : armed ? 'Disarm' : 'Arm'}
        </button>
        <label className="mode-select-wrap">
          <span className="sr-only">Flight mode</span>
          <select
            className="mode-select"
            value={currentMode}
            disabled={!connected || !commandsEnabled || busy}
            onChange={(event) => sendCommand('set_mode', { mode: event.target.value })}
          >
            <option value="" disabled>Set mode</option>
            {MODE_OPTIONS.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <button
          className="nav-button"
          type="button"
          disabled={!connected || !commandsEnabled || busy || !armed}
          title={armed ? 'Takeoff' : 'Arm the vehicle before takeoff'}
          onClick={() => sendCommand('takeoff', { altitude_m: 10 })}
        >
          Takeoff 10 m
        </button>
        <button
          className="nav-button"
          type="button"
          disabled={!connected || !commandsEnabled || busy}
          onClick={() => sendCommand('land')}
        >
          Land
        </button>
        <button
          className="nav-button safety-button"
          type="button"
          disabled={!connected || !commandsEnabled || busy}
          onClick={() => sendCommand('rtl')}
        >
          RTL
        </button>
      </div>

      {notice && <div className="nav-notice" role="status">{notice}</div>}
    </header>
  )
}
