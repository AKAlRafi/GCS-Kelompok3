import { useState } from 'react'
import './sidebar.css'

const telemetryItems = [
  ['Latitude', '—', '°'],
  ['Longitude', '—', '°'],
  ['Relative altitude', '—', 'm'],
  ['Altitude AMSL', '—', 'm'],
  ['Ground speed', '—', 'm/s'],
  ['Air speed', '—', 'm/s'],
  ['Heading', '—', '°'],
  ['Roll', '—', '°'],
  ['Pitch', '—', '°'],
  ['Yaw', '—', '°'],
  ['Battery', '—', '%'],
  ['GPS fix', '—', ''],
  ['Satellites', '—', ''],
  ['HDOP', '—', ''],
]

function PlaceholderButton({ children, primary = false, danger = false }) {
  return (
    <button
      className={`sidebar-button${primary ? ' primary' : ''}${danger ? ' danger' : ''}`}
      type="button"
    >
      {children}
    </button>
  )
}

function MissionSidebar() {
  return (
    <div className="sidebar-content">
      <section className="sidebar-section">
        <h3>Mission Planner</h3>
        <div className="sidebar-button-row single">
          <PlaceholderButton primary>Add Waypoint</PlaceholderButton>
        </div>
        <div className="waypoint-placeholder">
          <div className="waypoint-placeholder-head"><span>#</span><span>Waypoint</span><span>Alt. (m)</span></div>
          <p>No waypoints added</p>
        </div>
        <span className="sidebar-note">Click the map to add a waypoint</span>
      </section>

      <section className="sidebar-section">
        <h3>Mission Management</h3>
        <label className="sidebar-label" htmlFor="placeholder-mission-name">Mission name</label>
        <input id="placeholder-mission-name" className="sidebar-input" placeholder="Enter mission name" />
        <label className="sidebar-label" htmlFor="placeholder-saved-mission">Saved missions</label>
        <select id="placeholder-saved-mission" className="sidebar-input" defaultValue="">
          <option value="">Select a mission</option>
        </select>
        <div className="sidebar-button-row">
          <PlaceholderButton>Save Mission</PlaceholderButton>
          <PlaceholderButton>Download .waypoints</PlaceholderButton>
          <PlaceholderButton primary>Upload Mission</PlaceholderButton>
          <PlaceholderButton primary>Start Mission</PlaceholderButton>
          <PlaceholderButton>Pause</PlaceholderButton>
          <PlaceholderButton>Resume</PlaceholderButton>
          <PlaceholderButton>Reset Map</PlaceholderButton>
          <PlaceholderButton danger>Delete Mission</PlaceholderButton>
          <PlaceholderButton>Clear Mission on Drone</PlaceholderButton>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Mission Progress</h3>
        <div className="sidebar-status-list">
          <span>Stage <b>—</b></span>
          <span>Active waypoint <b>—</b></span>
          <span>Distance to next <b>— m</b></span>
          <span>Bearing to next <b>—°</b></span>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Map Layers</h3>
        <div className="sidebar-button-row">
          <PlaceholderButton>Home Marker</PlaceholderButton>
          <PlaceholderButton>Mission Route</PlaceholderButton>
          <PlaceholderButton>Flight Trail</PlaceholderButton>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Flight Log</h3>
        <div className="sidebar-button-row">
          <PlaceholderButton primary>Start Recording</PlaceholderButton>
          <PlaceholderButton>Stop Recording</PlaceholderButton>
        </div>
        <div className="log-placeholder">No flight logs</div>
        <PlaceholderButton>Download Log</PlaceholderButton>
      </section>
    </div>
  )
}

function PlaneStatusSidebar() {
  return (
    <div className="sidebar-content">
      <section className="sidebar-section">
        <h3>Vehicle Status</h3>
        <div className="sidebar-badges">
          <span>Server <b>—</b></span>
          <span>Vehicle <b>—</b></span>
          <span>Armed <b>—</b></span>
          <span>Mode <b>—</b></span>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Telemetry</h3>
        <div className="telemetry-placeholder-grid">
          {telemetryItems.map(([label, value, unit]) => (
            <div className="telemetry-placeholder" key={label}>
              <span>{label}</span>
              <b>{value}<small>{unit}</small></b>
            </div>
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Safety</h3>
        <div className="safety-placeholder">No safety alerts</div>
        <div className="sidebar-status-list">
          <span>Telemetry <b>—</b></span>
          <span>Last update <b>—</b></span>
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Attitude</h3>
        <div className="sidebar-status-list">
          <span>Roll <b>—°</b></span>
          <span>Pitch <b>—°</b></span>
          <span>Compass heading <b>—°</b></span>
        </div>
      </section>
    </div>
  )
}

export default function More() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState('mission')

  return (
    <aside className={`more${open ? ' is-open' : ''}`} aria-label="Flight controls sidebar">
      <div className="more-panel">
        <div className="more-tabs" role="tablist" aria-label="Sidebar sections">
          <button
            className={tab === 'mission' ? 'selected' : ''}
            type="button"
            role="tab"
            aria-selected={tab === 'mission'}
            onClick={() => setTab('mission')}
          >
            Mission
          </button>
          <button
            className={tab === 'status' ? 'selected' : ''}
            type="button"
            role="tab"
            aria-selected={tab === 'status'}
            onClick={() => setTab('status')}
          >
            Plane Status
          </button>
        </div>
        <div className="more-tab-content" role="tabpanel">
          {tab === 'mission' ? <MissionSidebar /> : <PlaneStatusSidebar />}
        </div>
      </div>
      <button
        className="more-toggle"
        type="button"
        aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '‹' : '›'}
      </button>
    </aside>
  )
}
