import { useEffect, useRef, useState } from 'react'
import './sidebar.css'

const telemetryItems = [
  ['Latitude', 'lat', '°'], ['Longitude', 'lon', '°'],
  ['Relative altitude', 'rel_alt', 'm'], ['Altitude AMSL', 'alt', 'm'],
  ['Ground speed', 'groundspeed', 'm/s'], ['Air speed', 'airspeed', 'm/s'],
  ['Heading', 'heading', '°'], ['Roll', 'roll', '°'], ['Pitch', 'pitch', '°'], ['Yaw', 'yaw', '°'],
  ['Battery', 'battery_percent', '%'], ['GPS fix', 'gps_fix_type', ''],
  ['Satellites', 'satellites_visible', ''], ['HDOP', 'hdop', ''],
]

const extraTelemetryGroups = [
  { title: 'IMU', items: [
    ['Accel X', 'imu_ax', 'm/s²'], ['Accel Y', 'imu_ay', 'm/s²'], ['Accel Z', 'imu_az', 'm/s²'],
    ['Gyro X', 'imu_gx', '°/s'], ['Gyro Y', 'imu_gy', '°/s'], ['Gyro Z', 'imu_gz', '°/s'],
    ['Mag X', 'imu_mx', 'G'], ['Mag Y', 'imu_my', 'G'], ['Mag Z', 'imu_mz', 'G'],
  ] },
  { title: 'RC Link', items: [['RSSI Raw', 'rssi', ''], ['Signal', 'rssi_percent', '%']] },
  { title: 'Telemetry Radio', items: [
    ['Local RSSI Raw', 'radio_rssi', ''], ['Local RSSI', 'radio_rssi_dbm', 'dBm'],
    ['Remote RSSI Raw', 'radio_remrssi', ''], ['Remote RSSI', 'radio_remrssi_dbm', 'dBm'],
    ['Noise', 'radio_noise_dbm', 'dBm'], ['TX Buffer', 'radio_txbuf', '%'],
  ] },
  { title: 'Servo Outputs', items: [
    ['Servo 1', 'servo1', 'µs'], ['Servo 2', 'servo2', 'µs'], ['Servo 3', 'servo3', 'µs'], ['Servo 4', 'servo4', 'µs'],
    ['Servo 5', 'servo5', 'µs'], ['Servo 6', 'servo6', 'µs'], ['Servo 7', 'servo7', 'µs'], ['Servo 8', 'servo8', 'µs'],
  ] },
]

function displayValue(value, digits = 2) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(digits)
}

function formatLogTime(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function PlaceholderButton({ children, primary = false, danger = false, disabled = false, onClick, pressed }) {
  return (
    <button
      className={`sidebar-button${primary ? ' primary' : ''}${danger ? ' danger' : ''}${pressed ? ' selected' : ''}`}
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function MissionSidebar({
  waypoints, missions, missionName, selectedMissionId, missionProgress, navigationGuidance,
  flightLogs, activeLog, busyAction, message, addingWaypoint, homeVisible, routeVisible, trailVisible,
  tlogFiles = [], selectedTlog = '', replayActive = false, replayPlaying = false,
  replayPosition = 0, replayDuration = 0, replaySpeed = 1, replayMessage = '',
  missionPaused, onAddWaypointMode, onUpdateWaypoint, onDeleteWaypoint, onMissionNameChange,
  onLoadMission, onSaveMission, onUploadMission, onStartMission, onPauseMission, onResumeMission,
  onClearDroneMission, onDeleteMission, onDownloadMission, onReadDroneMission, onResetMap, onImportMission,
  onToggleHome, onToggleRoute, onToggleTrail, onStartLog, onStopLog, onDownloadLog, onRefreshLogs,
  onSelectTlog, onLoadTlog, onToggleTlogPlayback, onStopTlogReplay, onSeekTlogReplay, onTlogSpeedChange,
}) {
  const fileInput = useRef(null)
  const active = missionProgress && !['COMPLETED', 'IDLE', 'FAILED'].includes(missionProgress.stage)
  const canEdit = busyAction === ''

  return (
    <div className="sidebar-content">
      <section className="sidebar-section">
        <h3>Mission Planner</h3>
        <div className="sidebar-button-row single">
          <PlaceholderButton primary pressed={addingWaypoint} disabled={!canEdit} onClick={onAddWaypointMode}>
            {addingWaypoint ? 'Finish Adding' : 'Add Waypoint'}
          </PlaceholderButton>
        </div>
        <div className="waypoint-list">
          <div className="waypoint-placeholder-head"><span>#</span><span>Position</span><span>Alt. (m)</span><span /></div>
          {waypoints.length === 0 && <p className="empty-placeholder">No waypoints added</p>}
          {waypoints.map((point, index) => (
            <div className="waypoint-row" key={point.id || `${point.lat}-${point.lon}-${index}`}>
              <b>{index + 1}</b>
              <span className="waypoint-coordinates">{Number(point.lat).toFixed(6)}, {Number(point.lon).toFixed(6)}</span>
              <input
                aria-label={`Waypoint ${index + 1} altitude in meters`}
                type="number"
                min="1"
                max="120"
                step="1"
                value={point.alt}
                disabled={!canEdit}
                onChange={(event) => onUpdateWaypoint(point.id, { alt: Number(event.target.value) })}
              />
              <button type="button" className="waypoint-delete" aria-label={`Delete waypoint ${index + 1}`} disabled={!canEdit} onClick={() => onDeleteWaypoint(point.id)}>×</button>
            </div>
          ))}
        </div>
        <span className="sidebar-note">{addingWaypoint ? 'Click the map to place a waypoint' : 'Select Add Waypoint, then click the map'}</span>
      </section>

      <section className="sidebar-section">
        <h3>Mission Management</h3>
        <label className="sidebar-label" htmlFor="mission-name">Mission name</label>
        <input id="mission-name" className="sidebar-input" placeholder="Enter mission name" value={missionName} onChange={(event) => onMissionNameChange(event.target.value)} />
        <label className="sidebar-label" htmlFor="saved-mission">Saved missions</label>
        <select id="saved-mission" className="sidebar-input" value={selectedMissionId} disabled={!canEdit} onChange={(event) => onLoadMission(event.target.value)}>
          <option value="">Select a mission</option>
          {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.name} · {mission.waypoint_count} WP</option>)}
        </select>
        <div className="sidebar-button-row">
          <PlaceholderButton disabled={!canEdit || !missionName.trim() || waypoints.length === 0} onClick={onSaveMission}>Save Mission</PlaceholderButton>
          <PlaceholderButton disabled={!canEdit} onClick={() => onDownloadMission()}>Download from Drone</PlaceholderButton>
          <PlaceholderButton disabled={!canEdit} onClick={onReadDroneMission}>Read from Drone</PlaceholderButton>
          <PlaceholderButton disabled={!canEdit || waypoints.length === 0} onClick={() => onUploadMission(selectedMissionId)}>Upload Mission</PlaceholderButton>
          <PlaceholderButton primary disabled={!canEdit || waypoints.length === 0} onClick={() => onStartMission(selectedMissionId)}>Start Mission</PlaceholderButton>
          {active && !missionPaused && <PlaceholderButton disabled={!canEdit} onClick={onPauseMission}>Pause</PlaceholderButton>}
          {active && missionPaused && <PlaceholderButton disabled={!canEdit} onClick={onResumeMission}>Resume</PlaceholderButton>}
          <PlaceholderButton disabled={!canEdit} onClick={onResetMap}>Reset Map</PlaceholderButton>
          <PlaceholderButton danger disabled={!canEdit || !selectedMissionId} onClick={() => onDeleteMission(selectedMissionId)}>Delete Mission</PlaceholderButton>
          <PlaceholderButton disabled={!canEdit} onClick={onClearDroneMission}>Clear Mission on Drone</PlaceholderButton>
          <PlaceholderButton disabled={!canEdit} onClick={() => fileInput.current?.click()}>Import .waypoints</PlaceholderButton>
          <input ref={fileInput} className="sidebar-file-input" type="file" accept=".waypoint,.waypoints" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImportMission(file)
            event.target.value = ''
          }} />
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Mission Progress</h3>
        <div className="sidebar-status-list">
          <span>Stage <b>{missionProgress?.stage || '—'}</b></span>
          <span>Active waypoint <b>{missionProgress?.active_waypoint == null ? '—' : Number(missionProgress.active_waypoint) + 2}</b></span>
          <span>Distance to next <b>{displayValue(navigationGuidance?.distance_m, 1)} m</b></span>
          <span>Bearing to next <b>{displayValue(navigationGuidance?.bearing_deg, 1)}°</b></span>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Map Layers</h3>
        <div className="sidebar-button-row">
          <PlaceholderButton pressed={homeVisible} onClick={onToggleHome}>Home Marker</PlaceholderButton>
          <PlaceholderButton pressed={routeVisible} onClick={onToggleRoute}>Mission Route</PlaceholderButton>
          <PlaceholderButton pressed={trailVisible} onClick={onToggleTrail}>Flight Trail</PlaceholderButton>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-section-heading">
          <h3>Flight Log</h3>
          <button type="button" className="sidebar-refresh" onClick={onRefreshLogs} title="Refresh flight logs">↻</button>
        </div>
        <div className="sidebar-button-row">
          {!activeLog.active
            ? <PlaceholderButton primary disabled={!canEdit} onClick={onStartLog}>Start Recording</PlaceholderButton>
            : <PlaceholderButton danger disabled={!canEdit} onClick={onStopLog}>Stop Recording</PlaceholderButton>}
          <span className="log-state">{activeLog.active ? `Recording #${activeLog.id}` : 'Not recording'}</span>
        </div>
        {flightLogs.length === 0 && <div className="log-placeholder">No flight logs</div>}
        {flightLogs.map((log) => (
          <div className="flight-log-row" key={log.id}>
            <span><b>{log.name} <small className="log-format">{log.format || 'JSONL'}</small></b><small>{new Date(log.started_at).toLocaleString()}</small></span>
            <button type="button" className="sidebar-refresh" title="Download this flight log" onClick={() => onDownloadLog(log.id)}>↓</button>
          </div>
        ))}
      </section>

      <section className="sidebar-section tlog-replay-section">
        <h3>TLOG Replay</h3>
        <label className="sidebar-label" htmlFor="tlog-file">Recorded MAVLink logs</label>
        <select id="tlog-file" className="sidebar-input" value={selectedTlog} onChange={(event) => onSelectTlog(event.target.value)}>
          <option value="">Select a TLOG file</option>
          {tlogFiles.map((file) => (
            <option key={file.file_name} value={file.file_name}>
              {file.file_name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </option>
          ))}
        </select>
        <div className="tlog-controls">
          <PlaceholderButton disabled={!selectedTlog || busyAction !== ''} onClick={() => onLoadTlog(selectedTlog)}>Load TLOG</PlaceholderButton>
          <PlaceholderButton primary disabled={!replayActive} onClick={onToggleTlogPlayback}>
            {replayPlaying ? 'Pause' : 'Play'}
          </PlaceholderButton>
          <PlaceholderButton disabled={!replayActive} onClick={onStopTlogReplay}>Stop</PlaceholderButton>
          <select id="tlog-speed" className="sidebar-input tlog-speed-select" aria-label="Playback speed" title="Playback speed" value={replaySpeed} onChange={(event) => onTlogSpeedChange(event.target.value)}>
            {[0.5, 1, 2, 4].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
        </div>
        <div className="tlog-timeline">
          <input
            aria-label="TLOG playback position"
            type="range"
            min="0"
            max={Math.max(1, replayDuration)}
            step="100"
            value={Math.min(replayPosition, replayDuration)}
            disabled={!replayActive}
            onChange={(event) => onSeekTlogReplay(event.target.value)}
          />
          <span>{formatLogTime(replayPosition)} / {formatLogTime(replayDuration)}</span>
        </div>
        {replayMessage && <span className="sidebar-note tlog-message" role="status">{replayMessage}</span>}
        {replayActive && <span className="sidebar-note">Replay only moves the map and HUD. Flight controls still use live telemetry.</span>}
      </section>

      {message && <div className="sidebar-message" role="status">{message}</div>}
    </div>
  )
}

function PlaneStatusSidebar({ telemetry, serverOnline, vehicleConnected, socketConnected, lastTelemetryAt, safetyAlerts = [], failsafeAlert = '' }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const status = socketConnected && vehicleConnected && lastTelemetryAt && now - lastTelemetryAt < 5000 ? 'LIVE' : 'STALE'
  return (
    <div className="sidebar-content">
      <section className="sidebar-section">
        <h3>Vehicle Status</h3>
        <div className="sidebar-badges">
          <span>Server <b>{serverOnline ? 'ONLINE' : 'OFFLINE'}</b></span>
          <span>Vehicle <b>{vehicleConnected ? 'CONNECTED' : 'OFFLINE'}</b></span>
          <span>Armed <b>{telemetry.armed === true ? 'ARMED' : telemetry.armed === false ? 'DISARMED' : '—'}</b></span>
          <span>Mode <b>{telemetry.flight_mode || '—'}</b></span>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-section-heading">
          <h3>Telemetry</h3><b className={`telemetry-state${status === 'LIVE' ? ' live' : ''}`}>{status}</b>
        </div>
        <div className="telemetry-placeholder-grid">
          {telemetryItems.map(([label, field, unit]) => (
            <div className="telemetry-placeholder" key={field}>
              <span>{label}</span>
              <b>{field === 'gps_fix_type' ? (telemetry[field] == null ? '—' : `${telemetry[field]}D`) : displayValue(telemetry[field])}<small>{unit}</small></b>
            </div>
          ))}
        </div>
      </section>

      {extraTelemetryGroups.map((group) => (
        <section className="sidebar-section" key={group.title}>
          <h3>{group.title}</h3>
          <div className="telemetry-placeholder-grid">
            {group.items.map(([label, field, unit]) => (
              <div className="telemetry-placeholder" key={field}>
                <span>{label}</span><b>{displayValue(telemetry[field], 2)}<small>{unit}</small></b>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="sidebar-section">
        <h3>Safety</h3>
        {failsafeAlert && <div className="safety-alert critical">{failsafeAlert}</div>}
        {safetyAlerts.length > 0
          ? <div className="safety-alert-list">
              {safetyAlerts.map((alert) => (
                <div className={`safety-alert ${alert.severity}`} key={alert.id}>
                  <b>{alert.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</b>
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          : !failsafeAlert && <div className="safety-placeholder">No safety alerts</div>}
        <div className="sidebar-status-list">
          <span>Telemetry <b>{status}</b></span>
          <span>Last update <b>{lastTelemetryAt ? new Date(lastTelemetryAt).toLocaleTimeString() : '—'}</b></span>
        </div>
      </section>
    </div>
  )
}

export default function Sidebar(props) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState('mission')

  return (
    <aside className={`more${open ? ' is-open' : ''}`} aria-label="Flight controls sidebar">
      <div className="more-panel">
        <div className="more-tabs" role="tablist" aria-label="Sidebar sections">
          <button className={tab === 'mission' ? 'selected' : ''} type="button" role="tab" aria-selected={tab === 'mission'} onClick={() => setTab('mission')}>Mission</button>
          <button className={tab === 'status' ? 'selected' : ''} type="button" role="tab" aria-selected={tab === 'status'} onClick={() => setTab('status')}>Plane Status</button>
        </div>
        <div className="more-tab-content" role="tabpanel">
          {tab === 'mission' ? <MissionSidebar {...props} /> : <PlaneStatusSidebar {...props} />}
        </div>
      </div>
      <button className="more-toggle" type="button" aria-label={open ? 'Hide sidebar' : 'Show sidebar'} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? '‹' : '›'}
      </button>
    </aside>
  )
}
