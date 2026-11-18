import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [-7.7707, 110.3775]

function toPosition(point) {
  if (point?.lat == null || point?.lon == null) return null
  const lat = Number(point.lat)
  const lon = Number(point.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null
  return [lat, lon]
}

function makeVehicleIcon(heading) {
  const angle = Number.isFinite(Number(heading)) ? Number(heading) : 0
  const icon = `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${angle}deg);filter:drop-shadow(0 2px 3px #0009)"><path d="M17 2 29 29 17 23 5 29Z" fill="#e7c021" stroke="#101a2b" stroke-width="2" stroke-linejoin="round"/></svg>`

  return L.divIcon({ className: 'vehicle-marker', html: icon, iconSize: [34, 34], iconAnchor: [17, 17] })
}

function makePointIcon(label, type = 'waypoint') {
  return L.divIcon({
    className: `map-point-icon ${type}`,
    html: `<span>${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function CenterOnVehicle({ position, follow }) {
  const map = useMap()
  const centered = useRef(false)

  useEffect(() => {
    if (!position) return
    if (!centered.current || follow) {
      map.setView(position, Math.max(map.getZoom(), follow ? 17 : 15), { animate: false })
      centered.current = true
    }
  }, [map, position, follow])

  return null
}

function MapClickHandler({ enabled, onMapClick }) {
  useMapEvents({
    click(event) {
      if (enabled) onMapClick({ lat: event.latlng.lat, lon: event.latlng.lng })
    },
  })

  return null
}

function ResetMapView({ resetToken }) {
  const map = useMap()

  useEffect(() => {
    if (resetToken > 0) map.setView(DEFAULT_CENTER, 15, { animate: true })
  }, [map, resetToken])

  return null
}

function RotateMap({ enabled, bearing }) {
  const map = useMap()
  const rotation = useRef({ previous: null, angle: 0 })

  useEffect(() => {
    const pane = map.getPanes().mapPane
    const setOrigin = () => {
      const size = map.getSize()
      pane.style.width = `${size.x}px`
      pane.style.height = `${size.y}px`
      pane.style.transformOrigin = `${size.x / 2}px ${size.y / 2}px`
    }

    setOrigin()
    map.on('resize', setOrigin)
    return () => map.off('resize', setOrigin)
  }, [map])

  useEffect(() => {
    if (enabled) {
      map.dragging.disable()
      map.scrollWheelZoom.disable()
    } else {
      map.dragging.enable()
      map.scrollWheelZoom.enable()
    }

    return () => {
      map.dragging.enable()
      map.scrollWheelZoom.enable()
    }
  }, [enabled, map])

  useEffect(() => {
    const pane = map.getPanes().mapPane
    if (!enabled || !Number.isFinite(bearing)) {
      rotation.current = { previous: null, angle: 0 }
      pane.style.rotate = '0deg'
      return
    }

    const angle = ((bearing % 360) + 360) % 360
    if (rotation.current.previous === null) {
      rotation.current.angle = angle
    } else {
      rotation.current.angle += ((angle - rotation.current.previous + 540) % 360) - 180
    }
    rotation.current.previous = angle
    pane.style.transition = 'rotate 180ms linear'
    pane.style.rotate = `${rotation.current.angle}deg`
  }, [enabled, bearing, map])

  return null
}

export default function Map({
  position: vehiclePosition,
  heading,
  followVehicle,
  mapBearing,
  addingWaypoint = false,
  waypoints = [],
  home,
  flightTrail = [],
  showHome = true,
  showRoute = true,
  showTrail = true,
  resetToken = 0,
  onMapClick = () => {},
}) {
  const position = toPosition(vehiclePosition)
  const homePosition = toPosition(home)
  const vehicleIcon = useMemo(() => makeVehicleIcon(heading), [heading])
  const routePositions = waypoints.map(toPosition).filter(Boolean)
  const trailPositions = flightTrail.map(toPosition).filter(Boolean)

  return (
    <MapContainer className={`gcs-map${addingWaypoint ? ' is-adding-waypoint' : ''}`} center={DEFAULT_CENTER} zoom={15} style={{ height: '100%', width: '100%' }}>
      <CenterOnVehicle position={position} follow={followVehicle} />
      <ResetMapView resetToken={resetToken} />
      <RotateMap enabled={followVehicle} bearing={mapBearing} />
      <MapClickHandler enabled={addingWaypoint} onMapClick={onMapClick} />
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {showTrail && trailPositions.length > 1 && <Polyline positions={trailPositions} pathOptions={{ color: '#e7c021', weight: 3, opacity: 0.6, dashArray: '6 7' }} />}
      {showRoute && routePositions.length > 1 && <Polyline positions={routePositions} pathOptions={{ color: '#e7c021', weight: 4, opacity: 0.95 }} />}
      {showHome && homePosition && <Marker position={homePosition} icon={makePointIcon('H', 'home')} />}
      {waypoints.map((point, index) => {
        const pointPosition = toPosition(point)
        if (!pointPosition) return null
        return (
          <Marker key={point.id || `${point.lat}-${point.lon}-${index}`} position={pointPosition} icon={makePointIcon(index + 1)}>
            <Tooltip>WP {index + 1} · {Number(point.alt).toFixed(0)} m</Tooltip>
          </Marker>
        )
      })}
      {position && <Marker position={position} icon={vehicleIcon} interactive={false} zIndexOffset={1000} />}
    </MapContainer>
  )
}
