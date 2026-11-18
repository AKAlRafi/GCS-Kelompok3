import { useEffect, useState } from 'react'
import './App.css'
import Hud from './components/hud'
import Map from './components/map'
import Navbar from './components/navbar'
import More from './components/sidebar'
import { socket } from './services/socket'

function App() {
  const [telemetry, setTelemetry] = useState({})
  const [followVehicle, setFollowVehicle] = useState(false)
  const [socketConnected, setSocketConnected] = useState(socket.connected)
  const [lastTelemetryAt, setLastTelemetryAt] = useState(null)

  useEffect(() => {
    const handleConnect = () => setSocketConnected(true)
    const handleDisconnect = () => setSocketConnected(false)
    const receiveTelemetry = (data) => {
      if (data && typeof data === 'object') {
        setTelemetry((current) => ({ ...current, ...data }))
        setLastTelemetryAt(Date.now())
      }
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('telemetry', receiveTelemetry)
    socket.connect()

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('telemetry', receiveTelemetry)
      socket.disconnect()
    }
  }, [])

  const rawHeading = telemetry.heading ?? telemetry.yaw
  const heading = Number(rawHeading)
  const mapBearing = followVehicle && rawHeading != null && Number.isFinite(heading)
    ? ((360 - (heading % 360)) % 360)
    : 0

  return (
    <div className="app-shell">
      <Navbar/>
      <More/>
      <main className="map-stage" id="main-map" aria-label="Flight map">
        <Map
          position={{ lat: telemetry.lat, lon: telemetry.lon }}
          heading={rawHeading}
          followVehicle={followVehicle}
          mapBearing={mapBearing}
        />
        <Hud
          telemetry={telemetry}
          mapBearing={mapBearing}
          followVehicle={followVehicle}
          socketConnected={socketConnected}
          lastTelemetryAt={lastTelemetryAt}
          onToggleFollow={() => setFollowVehicle((following) => !following)}
        />
      </main>
    </div>
  )
}

export default App
