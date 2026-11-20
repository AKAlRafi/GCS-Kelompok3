import { useEffect, useState } from 'react'
import { socket } from '../services/socket'
import { sendCommand } from '../services/api'

const SENSORS = [
    ['gyro', 'Gyro'],
    ['baro', 'Barometer'],
    ['airspeed', 'Airspeed'],
    ['level', 'Level (trim)'],
    ['accel', 'Accelerometer (6 positions)'],
    ['accel_simple', 'Accelerometer (simple)'],
    ['mag', 'Compass'],
]
const POSITIONS = {
    1: 'Level',
    2: 'Left side down',
    3: 'Right side down',
    4: 'Nose down',
    5: 'Nose up',
    6: 'On its back',
}
const FINAL = ['done', 'failed', 'cancelled']
const INITIAL = { sensor: '', status: '', running: false, percent: null, position: null, messages: [], note: '' }

export default function Calibration() {
    const [sensor, setSensor] = useState('gyro')
    const [state, setState] = useState(INITIAL)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        const onEvent = (e) => {
        if (!e || e.event !== 'calibration') return
        setState((s) => {
            const next = { ...s, status: e.status, sensor: e.sensor || s.sensor }
            if (e.status === 'started') Object.assign(next, { running: true, percent: null, position: null, messages: [], note: '' })
            if (e.status === 'progress') next.percent = e.percent
            if (e.status === 'position_needed') next.position = e.position
            if (e.status === 'position_confirmed') next.position = null
            if (e.status === 'message' && e.message) next.messages = [...s.messages, e.message].slice(-5)
            if (FINAL.includes(e.status)) Object.assign(next, { running: false, position: null, note: e.message || '' })
            return next
        })
        }
        socket.on('calibration', onEvent)
        return () => socket.off('calibration', onEvent)
    }, [])

    const run = async (type, payload) => {
        setBusy(true)
        setError('')
        try {
        await sendCommand(type, payload)
        } catch (e) {
        setError(e.message || 'Command failed')
        } finally {
        setBusy(false)
        }
    }

    const cancel = async () => {
        await run('calibrate_cancel')
        setState((s) => ({ ...s, running: false, position: null }))
    }

    const label = SENSORS.find(([key]) => key === state.sensor)?.[1] || state.sensor

    return (
        <div className="sidebar-content">
        <section className="sidebar-section">
            <h3>Calibration</h3>
            <span className="sidebar-note">Vehicle must be disarmed.</span>
            <label className="sidebar-label" htmlFor="cal-sensor">Sensor</label>
            <select
                id="cal-sensor"
                className="sidebar-input"
                value={sensor}
                disabled={busy}
                onChange={(e) => setSensor(e.target.value)}
            >
            {SENSORS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
            <div className="sidebar-button-row">
            <button
                className="sidebar-button primary"
                type="button"
                disabled={busy || state.running}
                onClick={() => run('calibrate', { sensor })}
            >
                Start
            </button>
            <button
                className="sidebar-button danger cursor-pointer"
                type="button"
                disabled={busy || !state.running}
                onClick={cancel}
            >
                Cancel
            </button>
            </div>
            {error && <span className="sidebar-note">{error}</span>}
        </section>

        {state.status && (
            <section className="sidebar-section">
            <h3>Progress</h3>
            <div className="sidebar-status-list">
                <span>Sensor <b>{label}</b></span>
                <span>Status <b>{state.status}</b></span>
            </div>

            {state.percent != null && (
                <div style={{ height: 8, margin: '8px 0', background: '#26354d', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, state.percent))}%`, height: '100%', background: 'var(--accent, #e7c021)' }} />
                </div>
            )}

            {state.position != null && (
                <>
                <span className="sidebar-note">Place the plane: {POSITIONS[state.position]}. Hold still, then confirm.</span>
                <button
                    className="sidebar-button primary"
                    type="button"
                    disabled={busy}
                    onClick={() => run('calibrate_confirm', { position: state.position })}
                >
                    Confirm: {POSITIONS[state.position]}
                </button>
                </>
            )}

            {state.running && state.sensor === 'mag' && (
                <>
                <span className="sidebar-note">Rotate the plane slowly around all axes.</span>
                <button className="sidebar-button" type="button" disabled={busy} onClick={() => run('calibrate_accept')}>
                    Accept
                </button>
                </>
            )}

            {state.note && <span className="sidebar-note">{state.note}</span>}
            {state.messages.length > 0 && (
                <div className="sidebar-status-list">
                {state.messages.map((m, i) => <span key={i}>{m}</span>)}
                </div>
            )}
            </section>
        )}
        </div>
    )
}