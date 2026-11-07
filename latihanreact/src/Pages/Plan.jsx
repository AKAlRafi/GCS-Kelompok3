
import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../App.css'
import GeomanTools from '../components/GeomanTools'

export const Plan = () => {
  const mapContainer = useRef(null)
  const mapInstance = useRef(null)

  useEffect(() => {
    const map = L.map(mapContainer.current, {zoomControl: false}).setView([-7.7651462, 110.366628], 17)
    mapInstance.current = map

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map)

    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [])

  return (
    <div>
        <GeomanTools/>
        <div ref={mapContainer} className="mapContainer"></div>
    </div>
  )
}
