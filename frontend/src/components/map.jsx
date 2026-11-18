import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [-7.7707, 110.3775]

function makeVehicleIcon(heading) {
  const angle = Number.isFinite(Number(heading)) ? Number(heading) : 0
  const icon = `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${angle}deg);filter:drop-shadow(0 2px 3px #0009)"><path d="M17 2 29 29 17 23 5 29Z" fill="#e7c021" stroke="#101a2b" stroke-width="2" stroke-linejoin="round"/></svg>`

  return L.divIcon({
    className: 'vehicle-marker',
    html: icon,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
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
      const difference = ((angle - rotation.current.previous + 540) % 360) - 180
      rotation.current.angle += difference
    }
    rotation.current.previous = angle

    const size = map.getSize()
    pane.style.width = `${size.x}px`
    pane.style.height = `${size.y}px`
    pane.style.transformOrigin = `${size.x / 2}px ${size.y / 2}px`
    pane.style.transition = 'rotate 180ms linear'
    pane.style.rotate = `${rotation.current.angle}deg`
  }, [enabled, bearing, map])

  return null
}

export default function Map({ position: vehiclePosition, heading, followVehicle, mapBearing }) {
  const position = useMemo(() => {
    if (vehiclePosition?.lat == null || vehiclePosition?.lon == null) return null
    const lat = Number(vehiclePosition?.lat)
    const lon = Number(vehiclePosition?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null
    return [lat, lon]
  }, [vehiclePosition?.lat, vehiclePosition?.lon])

  const vehicleIcon = useMemo(() => makeVehicleIcon(heading), [heading])

  return (
    <MapContainer
      className="gcs-map"
      center={DEFAULT_CENTER}
      zoom={15}
      style={{ height: '100%', width: '100%' }}
    >
      <CenterOnVehicle position={position} follow={followVehicle} />
      <RotateMap enabled={followVehicle} bearing={mapBearing} />
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {position && <Marker position={position} icon={vehicleIcon} interactive={false} zIndexOffset={1000} />}
    </MapContainer>
  )
}
