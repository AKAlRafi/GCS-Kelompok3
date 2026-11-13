import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { UGM_HOME } from '../utils/waypoints';
import droneMarker from '../assets/drone-marker.svg';

const DEFAULT_CENTER = [UGM_HOME.lat, UGM_HOME.lon];

function waypointIcon(number, active = false) {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border:2px solid white;border-radius:50%;background:${active ? '#0284c7' : '#334155'};color:white;display:grid;place-items:center;font-weight:700;font-size:12px;box-shadow:0 2px 6px #0008">${number}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function vehicleIcon(heading) {
  const rotation = Number.isFinite(Number(heading)) ? Number(heading) : 0;
  return L.divIcon({
    className: '',
    html: `<img src="${droneMarker}" alt="" style="width:42px;height:42px;display:block;transform:rotate(${rotation}deg);filter:drop-shadow(0 2px 3px #020617)" />`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

const homeIcon = L.divIcon({
  className: '',
  html: '<div style="width:24px;height:24px;border:2px solid white;border-radius:5px;background:#0f172a;color:#38bdf8;display:grid;place-items:center;font-weight:800;font-size:12px;box-shadow:0 2px 6px #0008">H</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function MapClickHandler({ enabled, onMapClick }) {
  useMapEvents({
    click(event) {
      if (enabled) onMapClick?.(event.latlng);
    },
  });
  return null;
}

function InitialVehicleView({ position, follow }) {
  const map = useMap();
  const centeredOnce = useRef(false);

  useEffect(() => {
    if (!position) return;
    const center = [position.lat, position.lon];
    if (!centeredOnce.current) {
      map.setView(center, 17, { animate: false });
      centeredOnce.current = true;
    } else if (follow) {
      map.setView(center, Math.max(map.getZoom(), 17), { animate: false });
    }
  }, [map, position, follow]);

  return null;
}

function ResetMapView({ resetViewKey }) {
  const map = useMap();
  useEffect(() => {
    if (resetViewKey > 0) map.setView(DEFAULT_CENTER, 16, { animate: true });
  }, [map, resetViewKey]);
  return null;
}

export default function MissionMap({
  waypoints = [],
  uav,
  home,
  trail = [],
  onMapClick,
  addingWaypoint = false,
  followVehicle = false,
  resetViewKey = 0,
  activeWaypointIndex = null,
}) {
  const uavLat = uav?.lat;
  const uavLon = uav?.lon;
  const position = useMemo(() => (
    uavLat != null && uavLon != null
      && Number.isFinite(Number(uavLat)) && Number.isFinite(Number(uavLon))
      ? { lat: Number(uavLat), lon: Number(uavLon) }
      : null
  ), [uavLat, uavLon]);
  const vehicleHeading = uav?.heading ?? uav?.yaw;
  const vehicleMarkerIcon = useMemo(() => vehicleIcon(vehicleHeading), [vehicleHeading]);
  const waypointCount = waypoints.length;
  const waypointIcons = useMemo(() => Array.from({ length: waypointCount }, (_, index) => waypointIcon(index + 1, index === activeWaypointIndex)), [waypointCount, activeWaypointIndex]);
  const route = waypoints
    .filter((point) => point.lat != null && point.lon != null
      && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon)))
    .map((point) => [Number(point.lat), Number(point.lon)]);
  const homeLat = home?.lat ?? UGM_HOME.lat;
  const homeLon = home?.lon ?? UGM_HOME.lon;

  return (
    <div className={`h-[min(72vh,850px)] min-h-[460px] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-xl ${addingWaypoint ? 'cursor-crosshair' : ''}`}>
      <MapContainer center={DEFAULT_CENTER} zoom={16} className="h-full w-full" preferCanvas>
        <InitialVehicleView position={position} follow={followVehicle} />
        <ResetMapView resetViewKey={resetViewKey} />
        <MapClickHandler enabled={addingWaypoint} onMapClick={onMapClick} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[homeLat, homeLon]} icon={homeIcon} interactive={false} />
        {route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#38bdf8', weight: 3, dashArray: '7 7' }} />}
        {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#94a3b8', weight: 2 }} />}
        {waypoints.map((waypoint, index) => (
          <Marker
            key={waypoint.id ?? `${waypoint.lat}-${waypoint.lon}-${index}`}
            position={[Number(waypoint.lat), Number(waypoint.lon)]}
            icon={waypointIcons[index]}
          >
            <Popup>
              <strong>Titik Rute {index + 1}</strong>
              <div>Lintang: {Number(waypoint.lat).toFixed(6)}</div>
              <div>Bujur: {Number(waypoint.lon).toFixed(6)}</div>
            </Popup>
          </Marker>
        ))}
        {position && (
          <Marker
            position={[position.lat, position.lon]}
            icon={vehicleMarkerIcon}
            interactive={false}
            zIndexOffset={1000}
          />
        )}
      </MapContainer>
    </div>
  );
}
