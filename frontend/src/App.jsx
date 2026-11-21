import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import Hud from './components/hud'
import Map from './components/map'
import Navbar from './components/navbar'
import Sidebar from './components/sidebar'
import ParameterSearch from './components/param-searchbar'
import WaypointNotification from './components/waypoint-notif'
import DistanceToWaypoint from './components/distance-to-waypoints'
import { apiJson, apiRequest } from './services/api'
import { socket } from './services/socket'

function findSampleIndex(samples, time) {
  let low = 0
  let high = samples.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (samples[middle].t <= time) low = middle
    else high = middle - 1
  }
  return low
}

function formatReplayTime(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function App() {
  const [telemetry, setTelemetry] = useState({})
  const [followVehicle, setFollowVehicle] = useState(false)
  const [socketConnected, setSocketConnected] = useState(socket.connected)
  const [lastTelemetryAt, setLastTelemetryAt] = useState(null)
  const [waypoints, setWaypoints] = useState([])
  const [addingWaypoint, setAddingWaypoint] = useState(false)
  const [droneMission, setDroneMission] = useState(false)
  const [missionName, setMissionName] = useState('')
  const [missions, setMissions] = useState([])
  const [selectedMissionId, setSelectedMissionId] = useState('')
  const [missionDirty, setMissionDirty] = useState(false)
  const [missionProgress, setMissionProgress] = useState(null)
  const [navigationGuidance, setNavigationGuidance] = useState(null)
  const [missionPaused, setMissionPaused] = useState(false)
  const [flightLogs, setFlightLogs] = useState([])
  const [tlogFiles, setTlogFiles] = useState([])
  const [selectedTlog, setSelectedTlog] = useState('')
  const [replayFileName, setReplayFileName] = useState('')
  const [replaySamples, setReplaySamples] = useState([])
  const [replayDuration, setReplayDuration] = useState(0)
  const [replayPosition, setReplayPosition] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [replayMessage, setReplayMessage] = useState('')
  const [replayWaypoints, setReplayWaypoints] = useState([])
  const [replaySeekVersion, setReplaySeekVersion] = useState(0)
  const replayPositionRef = useRef(0)
  const [activeLog, setActiveLog] = useState({ active: false, id: null })
  const [serverOnline, setServerOnline] = useState(false)
  const [vehicleConnected, setVehicleConnected] = useState(false)
  const [homeVisible, setHomeVisible] = useState(true)
  const [routeVisible, setRouteVisible] = useState(true)
  const [trailVisible, setTrailVisible] = useState(true)
  const [flightTrail, setFlightTrail] = useState([])
  const [resetToken, setResetToken] = useState(0)
  const [busyAction, setBusyAction] = useState('')
  const [sidebarMessage, setSidebarMessage] = useState('')
  const [safetyAlerts, setSafetyAlerts] = useState([])
  const [failsafeAlert, setFailsafeAlert] = useState('')

  const receiveTelemetry = useCallback((data) => {
    if (!data || typeof data !== 'object') return
    setTelemetry((current) => ({ ...current, ...data }))
    const receivedAt = Date.parse(data.received_at)
    setLastTelemetryAt(Number.isFinite(receivedAt) ? receivedAt : Date.now())
    const lat = Number(data.lat)
    const lon = Number(data.lon)
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
      setFlightTrail((current) => {
        const previous = current[current.length - 1]
        if (previous && Math.abs(previous.lat - lat) < 0.000004 && Math.abs(previous.lon - lon) < 0.000004) return current
        return [...current.slice(-999), { lat, lon }]
      })
    }
  }, [])

  const loadMissions = useCallback(async () => {
    const data = await apiJson('/missions')
    setMissions(data.missions || [])
  }, [])

  const loadFlightLogs = useCallback(async () => {
    const [logs, status] = await Promise.all([
      apiJson('/logs'),
      apiJson('/logs/status'),
    ])
    setFlightLogs(Array.isArray(logs) ? logs : [])
    setActiveLog(status || { active: false, id: null })
  }, [])

  const loadTlogFiles = useCallback(async () => {
    const data = await apiJson('/tlogs')
    setTlogFiles(data.tlogs || [])
  }, [])

  const loadTlogReplay = useCallback(async (fileName) => {
    if (!fileName) throw new Error('Pilih file TLOG dulu.')
    setReplayPlaying(false)
    setReplayMessage('Loading TLOG…')
    try {
      const data = await apiJson(`/tlogs/${encodeURIComponent(fileName)}/replay`)
      setSelectedTlog(fileName)
      setReplayFileName(fileName)
      setReplaySamples(data.samples || [])
      setReplayDuration(data.duration_ms || 0)
      setReplayWaypoints((data.waypoints || []).map((point, index) => ({ ...point, id: `replay-${index}` })))
      replayPositionRef.current = 0
      setReplayPosition(0)
      setReplayMessage(data.samples?.length ? '' : 'TLOG tidak berisi posisi drone.')
    } catch (error) {
      setReplaySamples([])
      setReplayDuration(0)
      setReplayWaypoints([])
      setReplayMessage(error.message || 'TLOG gagal dibuka.')
      throw error
    }
  }, [])

  const stopTlogReplay = useCallback(() => {
    setReplayPlaying(false)
    setReplaySamples([])
    setReplayDuration(0)
    setReplayFileName('')
    setReplayMessage('')
    replayPositionRef.current = 0
    setReplayPosition(0)
  }, [])

  const seekTlogReplay = useCallback((value) => {
    const position = Number(value)
    replayPositionRef.current = position
    setReplayPosition(position)
    setReplaySeekVersion((version) => version + 1)
  }, [])

  const toggleTlogReplay = useCallback(() => {
    if (replayPositionRef.current >= replayDuration) {
      replayPositionRef.current = 0
      setReplayPosition(0)
    }
    setReplayPlaying((playing) => !playing)
  }, [replayDuration])

  useEffect(() => {
    if (!replayPlaying || replaySamples.length === 0) return undefined
    const startPosition = replayPositionRef.current
    const startedAt = performance.now()
    const timer = window.setInterval(() => {
      const nextPosition = Math.min(replayDuration, startPosition + (performance.now() - startedAt) * replaySpeed)
      replayPositionRef.current = nextPosition
      setReplayPosition(nextPosition)
      if (nextPosition >= replayDuration) setReplayPlaying(false)
    }, 100)
    return () => window.clearInterval(timer)
  }, [replayPlaying, replaySamples.length, replayDuration, replaySpeed, replaySeekVersion])

  const loadMission = useCallback(async (id) => {
    if (!id) return
    const data = await apiJson(`/missions/${id}`)
    const mission = data.mission
    setSelectedMissionId(String(mission.id))
    setMissionName(mission.name || '')
    setWaypoints((mission.waypoints || []).map((point, index) => ({
      ...point,
      id: `${mission.id}-${index}-${crypto.randomUUID()}`,
    })))
    setMissionDirty(false)
    setMissionProgress(null)
    setNavigationGuidance(null)
    setMissionPaused(false)
  }, [])

  const saveMission = useCallback(async () => {
    if (!missionName.trim()) throw new Error('Isi nama misi dulu.')
    if (waypoints.length === 0) throw new Error('Tambahkan waypoint dulu.')
    const data = await apiJson('/missions', {
      method: 'POST',
      body: JSON.stringify({
        name: missionName.trim(),
        waypoints: waypoints.map(({ command, frame, param1, param2, param3, param4, lat, lon, alt, autocontinue }) => ({
          command, frame, param1, param2, param3, param4, lat, lon, alt, autocontinue,
        })),
      }),
    })
    setSelectedMissionId(String(data.mission.id))
    setMissionDirty(false)
    await loadMissions()
    return String(data.mission.id)
  }, [loadMissions, missionName, waypoints])

  const ensureSavedMission = useCallback(async (requestedId) => {
    if (!missionDirty && requestedId && String(requestedId) === selectedMissionId) return selectedMissionId
    return saveMission()
  }, [missionDirty, saveMission, selectedMissionId])

  const fetchDroneMission = useCallback(async () => {
    const data = await apiJson('/fc/missions/download')
    if (data.ok === false) throw new Error(data.error || 'Gagal membaca misi dari drone.')
    if (!data.waypoints?.length) throw new Error('Tidak ada misi di drone.')
    return data.waypoints
  }, [])

  const readDroneMission = useCallback(async () => {
    const droneWaypoints = await fetchDroneMission()
    setWaypoints(droneWaypoints.map((point, index) => ({ ...point, id: `drone-${index}-${crypto.randomUUID()}` })))
    setSelectedMissionId('')
    setMissionName('')
    setMissionDirty(true)
    setDroneMission(true)
    setMissionProgress(null)
    setNavigationGuidance(null)
    setMissionPaused(false)
  }, [fetchDroneMission])

  const downloadMission = useCallback(async () => {
    const droneWaypoints = await fetchDroneMission()
    const saved = await apiJson('/missions', {
      method: 'POST',
      body: JSON.stringify({
        name: missionName.trim() || `drone-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
        waypoints: droneWaypoints.map(({ command, frame, param1, param2, param3, param4, lat, lon, alt, autocontinue }) => ({
          command, frame, param1, param2, param3, param4, lat, lon, alt, autocontinue,
        })),
      }),
    })
    await loadMissions()
    await loadMission(saved.mission.id)
  }, [fetchDroneMission, loadMission, loadMissions, missionName])

  const importMission = useCallback(async (file) => {
    const form = new FormData()
    form.append('file', file)
    const data = await apiJson('/missions/import', { method: 'POST', body: form })
    await loadMissions()
    await loadMission(data.mission.id)
  }, [loadMission, loadMissions])

  const uploadMission = useCallback(async (id) => {
    const missionId = await ensureSavedMission(id)
    const result = await apiJson(`/missions/${missionId}/upload`, { method: 'POST' })
    if (result.ok === false) throw new Error(result.error || 'Upload misi ditolak.')
  }, [ensureSavedMission])

  const startMission = useCallback(async (id) => {
    const missionId = await ensureSavedMission(id)
    setMissionProgress({ stage: 'PREPARING', active_waypoint: 0 })
    setMissionPaused(false)
    const result = await apiJson(`/missions/${missionId}/start`, { method: 'POST' })
    if (result.ok === false) throw new Error(result.error || 'Misi gagal dimulai.')
  }, [ensureSavedMission])

  const sendMissionCommand = useCallback(async (type) => {
    const result = await apiJson('/missions/command', {
      method: 'POST',
      body: JSON.stringify({ type }),
    })
    if (result.ok === false) throw new Error(result.error || `Perintah ${type} ditolak.`)
    return result
  }, [])

  const pauseMission = useCallback(async () => {
    await sendMissionCommand('pause_mission')
    setMissionPaused(true)
    setMissionProgress((current) => ({ ...current, stage: 'PAUSED' }))
  }, [sendMissionCommand])

  const resumeMission = useCallback(async () => {
    await sendMissionCommand('resume_mission')
    setMissionPaused(false)
    setMissionProgress((current) => ({ ...current, stage: 'NAVIGATING_WAYPOINT' }))
  }, [sendMissionCommand])

  const clearDroneMission = useCallback(async () => {
    if (!window.confirm('Hapus misi yang tersimpan di flight controller?')) return false
    await sendMissionCommand('clear_mission')
    return true
  }, [sendMissionCommand])

  const deleteMission = useCallback(async (id) => {
    if (!id) throw new Error('Pilih misi yang mau dihapus.')
    if (!window.confirm('Hapus misi tersimpan ini dari komputer?')) return false
    await apiJson(`/missions/${id}`, { method: 'DELETE' })
    setMissions((current) => current.filter((mission) => String(mission.id) !== String(id)))
    if (String(id) === selectedMissionId) {
      setSelectedMissionId('')
      setWaypoints([])
      setMissionName('')
      setMissionDirty(false)
    }
  }, [selectedMissionId])

  const resetMap = useCallback(() => {
    setWaypoints([])
    setMissionName('')
    setSelectedMissionId('')
    setMissionDirty(false)
    setAddingWaypoint(false)
    setMissionProgress(null)
    setNavigationGuidance(null)
    setFlightTrail([])
    setFollowVehicle(false)
    setResetToken((current) => current + 1)
  }, [])

  const startFlightLog = useCallback(async () => {
    await apiJson('/logs/start', { method: 'POST', body: JSON.stringify({ name: 'flight' }) })
    await loadFlightLogs()
  }, [loadFlightLogs])

  const stopFlightLog = useCallback(async () => {
    await apiJson('/logs/stop', { method: 'POST' })
    await loadFlightLogs()
  }, [loadFlightLogs])

  const downloadFlightLog = useCallback(async (id) => {
    const response = await apiRequest(`/logs/${id}/download`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = flightLogs.find((log) => Number(log.id) === Number(id))?.file_name || `flight-${id}.jsonl`
    link.click()
    URL.revokeObjectURL(url)
  }, [flightLogs])

  const downloadTlog = useCallback(async (fileName) => {
    if (!fileName) throw new Error('Pilih file TLOG dulu.')
    const response = await apiRequest(`/tlogs/${encodeURIComponent(fileName)}/download`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const updateWaypoint = useCallback((id, changes) => {
    setWaypoints((current) => current.map((point) => point.id === id ? { ...point, ...changes } : point))
    setMissionDirty(true)
  }, [])

  const addWaypoint = useCallback((position) => {
    setWaypoints((current) => [...current, {
      id: crypto.randomUUID(), command: 16, frame: 3, lat: position.lat, lon: position.lon, alt: 100,
      param1: 0, param2: 0, param3: 0, param4: 0, autocontinue: 1,
    }])
    setMissionDirty(true)
  }, [])

  const deleteWaypoint = useCallback((id) => {
    setWaypoints((current) => current.filter((point) => point.id !== id))
    setMissionDirty(true)
  }, [])

  const runAction = useCallback(async (name, action) => {
    setBusyAction(name)
    setSidebarMessage('')
    try {
      const result = await action()
      if (result === false) return
      setSidebarMessage(`${name} berhasil.`)
    } catch (error) {
      setSidebarMessage(error.message || 'Aksi gagal dijalankan.')
    } finally {
      setBusyAction('')
    }
  }, [])

  useEffect(() => {
    const handleConnect = () => setSocketConnected(true)
    const handleDisconnect = () => setSocketConnected(false)
    const handleMissionProgress = (progress) => {
      setMissionProgress(progress)
      if (progress.stage === 'COMPLETED') setMissionPaused(false)
    }
    const handleNavigationGuidance = setNavigationGuidance
    const handleSafetyAlerts = (alerts) => setSafetyAlerts(Array.isArray(alerts) ? alerts : [])
    const handleFailsafe = (warning) => setFailsafeAlert(warning?.message || warning?.reason || 'Failsafe aktif.')

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('telemetry', receiveTelemetry)
    socket.on('mission_progress', handleMissionProgress)
    socket.on('navigation_guidance', handleNavigationGuidance)
    socket.on('safety_alerts', handleSafetyAlerts)
    socket.on('failsafe_warning', handleFailsafe)
    socket.connect()

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('telemetry', receiveTelemetry)
      socket.off('mission_progress', handleMissionProgress)
      socket.off('navigation_guidance', handleNavigationGuidance)
      socket.off('safety_alerts', handleSafetyAlerts)
      socket.off('failsafe_warning', handleFailsafe)
      socket.disconnect()
    }
  }, [receiveTelemetry])

  useEffect(() => {
    let active = true
    const refreshStatus = async () => {
      try {
        const [health, connection, state] = await Promise.all([
          apiJson('/health'), apiJson('/connection/status'), apiJson('/telemetry'),
        ])
        if (!active) return
        setServerOnline(Boolean(health.ok))
        setVehicleConnected(Boolean(connection.connected))
        if (state && Object.keys(state).length) receiveTelemetry(state)
      } catch {
        if (active) {
          setServerOnline(false)
          setVehicleConnected(false)
        }
      }
    }

    void refreshStatus()
    const timer = window.setInterval(refreshStatus, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [receiveTelemetry])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadMissions().catch((error) => setSidebarMessage(error.message))
      void loadFlightLogs().catch(() => {})
      void loadTlogFiles().catch(() => {})
    }, 0)
    const timer = window.setInterval(() => {
      void loadMissions().catch(() => {})
      void loadFlightLogs().catch(() => {})
      void loadTlogFiles().catch(() => {})
    }, 10000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [loadFlightLogs, loadMissions, loadTlogFiles])

  const replayActive = replaySamples.length > 0
  const replayIndex = replayActive ? findSampleIndex(replaySamples, replayPosition) : -1
  const displayTelemetry = replayActive ? replaySamples[replayIndex] : telemetry
  const displayTrail = replayActive
    ? replaySamples.slice(Math.max(0, replayIndex - 499), replayIndex + 1)
    : flightTrail
  const rawHeading = displayTelemetry.heading ?? displayTelemetry.yaw
  const heading = Number(rawHeading)
  const mapBearing = followVehicle && rawHeading != null && Number.isFinite(heading)
    ? ((360 - (heading % 360)) % 360)
    : 0

  return (
    <div className="app-shell">
      <Navbar />
      <Sidebar
        waypoints={waypoints}
        missions={missions}
        missionName={missionName}
        selectedMissionId={selectedMissionId}
        missionProgress={missionProgress}
        navigationGuidance={navigationGuidance}
        activeLog={activeLog}
        flightLogs={flightLogs}
        tlogFiles={tlogFiles}
        selectedTlog={selectedTlog}
        replayActive={replayActive}
        replayPlaying={replayPlaying}
        replayPosition={replayPosition}
        replayDuration={replayDuration}
        replaySpeed={replaySpeed}
        replayMessage={replayMessage}
        telemetry={telemetry}
        serverOnline={serverOnline}
        vehicleConnected={vehicleConnected}
        socketConnected={socketConnected}
        lastTelemetryAt={lastTelemetryAt}
        safetyAlerts={safetyAlerts}
        failsafeAlert={failsafeAlert}
        busyAction={busyAction}
        message={sidebarMessage}
        addingWaypoint={addingWaypoint}
        homeVisible={homeVisible}
        routeVisible={routeVisible}
        trailVisible={trailVisible}
        missionPaused={missionPaused}
        onAddWaypointMode={() => setAddingWaypoint((current) => !current)}
        onUpdateWaypoint={updateWaypoint}
        onDeleteWaypoint={deleteWaypoint}
        onMissionNameChange={(value) => { setMissionName(value); setMissionDirty(true) }}
        onLoadMission={(id) => runAction('Load mission', () => loadMission(id))}
        onSaveMission={() => runAction('Save mission', saveMission)}
        onUploadMission={(id) => runAction('Upload mission', () => uploadMission(id))}
        onStartMission={(id) => runAction('Start mission', () => startMission(id))}
        onPauseMission={() => runAction('Pause mission', pauseMission)}
        onResumeMission={() => runAction('Resume mission', resumeMission)}
        onClearDroneMission={() => runAction('Clear mission on drone', clearDroneMission)}
        onDeleteMission={(id) => runAction('Delete mission', () => deleteMission(id))}
        onDownloadMission={(id) => runAction('Download mission', () => downloadMission(id))}
        onReadDroneMission={() => runAction('Read mission from drone', readDroneMission)}
        onResetMap={resetMap}
        onImportMission={(file) => runAction('Import mission', () => importMission(file))}
        onToggleHome={() => setHomeVisible((current) => !current)}
        onToggleRoute={() => setRouteVisible((current) => !current)}
        onToggleTrail={() => setTrailVisible((current) => !current)}
        onStartLog={() => runAction('Start flight log', startFlightLog)}
        onStopLog={() => runAction('Stop flight log', stopFlightLog)}
        onDownloadLog={(id) => runAction('Download flight log', () => downloadFlightLog(id))}
        onRefreshLogs={() => runAction('Refresh flight logs', async () => { await Promise.all([loadFlightLogs(), loadTlogFiles()]) })}
        onSelectTlog={setSelectedTlog}
        onLoadTlog={(fileName) => runAction('Load TLOG replay', () => loadTlogReplay(fileName))}
        onDownloadTlog={(fileName) => runAction('Download TLOG', () => downloadTlog(fileName))}
        onToggleTlogPlayback={toggleTlogReplay}
        onStopTlogReplay={stopTlogReplay}
        onSeekTlogReplay={seekTlogReplay}
        onTlogSpeedChange={(speed) => setReplaySpeed(Number(speed))}
      />
      <ParameterSearch />
      <main className="map-stage" id="main-map" aria-label="Flight map">
        <Map
          position={{ lat: displayTelemetry.lat, lon: displayTelemetry.lon }}
          heading={rawHeading}
          followVehicle={followVehicle}
          mapBearing={mapBearing}
          addingWaypoint={addingWaypoint && !replayActive}
          waypoints={replayActive ? replayWaypoints : waypoints}
          home={{ lat: displayTelemetry.home_lat, lon: displayTelemetry.home_lon }}
          flightTrail={displayTrail}
          showHome={homeVisible}
          showRoute={routeVisible}
          showTrail={trailVisible}
          resetToken={resetToken}
          onMapClick={addWaypoint}
        />
        <Hud
          telemetry={displayTelemetry}
          mapBearing={mapBearing}
          followVehicle={followVehicle}
          socketConnected={socketConnected}
          lastTelemetryAt={lastTelemetryAt}
          onToggleFollow={() => setFollowVehicle((following) => !following)}
        />
        {replayActive && <div className="tlog-replay-indicator">TLOG REPLAY · {replayFileName}</div>}
        <WaypointNotification/>
        <DistanceToWaypoint waypoints={waypoints}/>
      </main>
    </div>
  )
}

export default App
