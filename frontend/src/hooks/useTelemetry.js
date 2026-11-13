import { useEffect, useState } from 'react';
import { connectionApi } from '../services/api';
import { socket } from '../services/socket';
import { normalizeTelemetry } from '../utils/waypoints';

const EMPTY = {
  lat: null,
  lon: null,
  alt: null,
  rel_alt: null,
  roll: 0,
  pitch: 0,
  yaw: 0,
  heading: null,
  groundspeed: null,
  airspeed: null,
  battery_percent: null,
  armed: null,
  flight_mode: null,
  gps_fix_type: null,
  satellites_visible: null,
  hdop: null,
  home_lat: null,
  home_lon: null,
};

export default function useTelemetry() {
  const [telemetry, setTelemetry] = useState(EMPTY);
  const [socketConnected, setSocketConnected] = useState(false);
  const [vehicleConnected, setVehicleConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [missionProgress, setMissionProgress] = useState(null);
  const [navigationGuidance, setNavigationGuidance] = useState(null);
  const [failsafeWarning, setFailsafeWarning] = useState(null);
  const [trail, setTrail] = useState([]);

  useEffect(() => {
    let mounted = true;
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => {
      setSocketConnected(false);
      setVehicleConnected(false);
    };
    const onTelemetry = (payload) => {
      const normalized = normalizeTelemetry(payload);
      setTelemetry((previous) => ({ ...previous, ...normalized }));
      if (Number.isFinite(normalized.lat) && Number.isFinite(normalized.lon)) {
        setTrail((previous) => {
          const last = previous.at(-1);
          if (last) {
            const latMeters = (normalized.lat - last[0]) * 111_320;
            const lonMeters = (normalized.lon - last[1]) * 111_320 * Math.cos(normalized.lat * Math.PI / 180);
            const distance = Math.hypot(latMeters, lonMeters);
            if (distance < 0.5) return previous;
            if (distance > 1000) return [[normalized.lat, normalized.lon]];
          }
          return [...previous.slice(-499), [normalized.lat, normalized.lon]];
        });
      }
      setLastUpdate(Date.now());
      setVehicleConnected(true);
    };
    const onMissionProgress = (progress) => setMissionProgress(progress);
    const onNavigationGuidance = (guidance) => setNavigationGuidance(guidance);
    const onFailsafeWarning = (warning) => setFailsafeWarning(warning);

    const refreshConnection = async () => {
      try {
        const status = await connectionApi.status();
        if (mounted) setVehicleConnected(Boolean(status.connected));
      } catch {
        if (mounted && !socket.connected) setVehicleConnected(false);
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('telemetry', onTelemetry);
    socket.on('mission_progress', onMissionProgress);
    socket.on('navigation_guidance', onNavigationGuidance);
    socket.on('failsafe_warning', onFailsafeWarning);
    socket.on('connect_error', onDisconnect);
    socket.connect();
    void refreshConnection();
    const connectionTimer = window.setInterval(refreshConnection, 3000);

    return () => {
      mounted = false;
      window.clearInterval(connectionTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('telemetry', onTelemetry);
      socket.off('mission_progress', onMissionProgress);
      socket.off('navigation_guidance', onNavigationGuidance);
      socket.off('failsafe_warning', onFailsafeWarning);
      socket.off('connect_error', onDisconnect);
      socket.disconnect();
    };
  }, []);

  return {
    telemetry,
    socketConnected,
    vehicleConnected,
    lastUpdate,
    missionProgress,
    navigationGuidance,
    failsafeWarning,
    trail,
  };
}
