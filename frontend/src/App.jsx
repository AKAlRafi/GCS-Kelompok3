import { useCallback, useEffect, useState } from 'react';
import useTelemetry from './hooks/useTelemetry';
import { newId, normalizeWp, UGM_HOME } from './utils/waypoints';
import { commandApi, missionApi } from './services/api';
import ConnectionBar from './components/ConnectionBar';
import MissionMap from './components/MissionMap';
import MissionPanel from './components/MissionPanel';
import TelemetryPanel from './components/TelemetryPanel';
import FlightLogPanel from './components/FlightLogPanel';
import AttitudeIndicator from './components/AttitudeIndicator';
import Compass from './components/Compass';

export default function App() {
  const [waypoints, setWaypoints] = useState([]);
  const [missions, setMissions] = useState([]);
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [missionName, setMissionName] = useState('');
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [followVehicle, setFollowVehicle] = useState(false);
  const [mapResetKey, setMapResetKey] = useState(0);
  const [missionRunState, setMissionRunState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const {
    telemetry,
    socketConnected,
    vehicleConnected,
    lastUpdate,
    missionProgress,
    navigationGuidance,
    failsafeWarning,
    trail,
  } = useTelemetry();

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), toast.type === 'safety' ? 10000 : toast.type === 'error' ? 7000 : 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!failsafeWarning) return;
    setToast({ type: 'safety', message: 'Flight safety warning. Check vehicle status.' });
  }, [failsafeWarning]);

  useEffect(() => {
    if (missionProgress?.stage === 'COMPLETED') setMissionRunState('idle');
    else if (['NAVIGATING_WAYPOINT', 'RETURNING_HOME', 'LANDING', 'TAKING_OFF', 'EXECUTING_ACTION'].includes(missionProgress?.stage)) {
      setMissionRunState((current) => current === 'paused' ? current : 'running');
    }
  }, [missionProgress]);

  const refreshMissions = useCallback(async () => {
    const response = await missionApi.list();
    setMissions(Array.isArray(response.missions) ? response.missions : []);
  }, []);

  useEffect(() => {
    let active = true;
    missionApi.list().then((response) => {
      if (active) setMissions(Array.isArray(response.missions) ? response.missions : []);
    }).catch((requestError) => {
      if (active) setToast({ type: 'error', message: requestError.message || 'Could not load missions.' });
    });
    return () => { active = false; };
  }, []);

  const runAction = async (action, successMessage) => {
    setBusy(true);
    setToast(null);
    try {
      const result = await action();
      const message = successMessage || result?.message;
      if (message) setToast({ type: 'success', message });
      return result;
    } catch (requestError) {
      setToast({ type: 'error', message: requestError.response?.data?.error || requestError.message || 'Request failed.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const executeCommand = (type, payload = {}) => {
    const labels = { arm: 'Arm command sent.', disarm: 'Disarm command sent.', takeoff: 'Takeoff command sent.', land: 'Land command sent.', rtl: 'RTL command sent.' };
    return runAction(() => commandApi.send(type, payload), labels[type] || 'Command sent.');
  };

  const selectMission = async (id) => {
    setSelectedMissionId(id);
    if (!id) return;
    const result = await runAction(() => missionApi.get(id), '');
    if (!result?.mission) return;
    setMissionName(result.mission.name || '');
    setWaypoints(normalizeWp(result.mission.waypoints || []));
  };

  const saveMission = async () => {
    if (waypoints.length === 0) {
      setToast({ type: 'error', message: 'Add at least one waypoint before saving.' });
      return;
    }
    const route = waypoints.map((waypoint, index) => ({
      lat: Number(waypoint.lat),
      lon: Number(waypoint.lon),
      alt: Number(waypoint.alt),
      command: Number(waypoint.command ?? (index === 0 ? 22 : 16)),
    }));
    const result = await runAction(
      () => missionApi.create({ name: missionName.trim() || 'GCS Mission', waypoints: route }),
      'Mission saved.',
    );
    if (result?.mission) {
      setSelectedMissionId(String(result.mission.id));
      setMissionName(result.mission.name);
      await refreshMissions().catch(() => {});
    }
  };

  const uploadMission = () => runAction(
    () => missionApi.upload(selectedMissionId),
    'Mission uploaded to the vehicle.',
  );

  const startMission = async () => {
    const result = await runAction(() => missionApi.start(selectedMissionId), 'Mission started.');
    if (result) setMissionRunState('running');
  };

  const missionControl = async (type) => {
    const result = await runAction(
      () => missionApi.control(type),
      type === 'pause_mission' ? 'Mission paused.' : 'Mission resumed.',
    );
    if (result) setMissionRunState(type === 'pause_mission' ? 'paused' : 'running');
  };

  const deleteMission = async () => {
    const result = await runAction(() => missionApi.remove(selectedMissionId), 'Saved mission deleted.');
    if (!result) return;
    setSelectedMissionId('');
    setWaypoints([]);
    setMissionName('');
    await refreshMissions().catch(() => {});
  };

  const clearVehicleMission = () => runAction(
    () => missionApi.clearFromVehicle(),
    'Mission cleared from the vehicle.',
  );

  const addWaypoint = ({ lat, lng }) => {
    setWaypoints((previous) => [...previous, {
      id: newId(),
      lat: Number(lat),
      lon: Number(lng),
      alt: 10,
    }]);
  };

  const updateAltitude = (id, altitude) => {
    setWaypoints((previous) => previous.map((waypoint) => (
      waypoint.id === id ? { ...waypoint, alt: altitude } : waypoint
    )));
  };

  const removeWaypoint = (id) => setWaypoints((previous) => previous.filter((waypoint) => waypoint.id !== id));

  const downloadMission = async () => {
    if (!selectedMissionId) return;
    const mission = missions.find((item) => String(item.id) === String(selectedMissionId));
    const baseName = (mission?.name || 'mission').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mission';
    const result = await runAction(() => missionApi.download(selectedMissionId), `Downloaded ${baseName}.waypoints.`);
    if (!result) return;
    const url = URL.createObjectURL(result.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${baseName}.waypoints`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const resetMap = () => {
    setWaypoints([]);
    setSelectedMissionId('');
    setMissionName('');
    setAddingWaypoint(false);
    setFollowVehicle(false);
    setMapResetKey((key) => key + 1);
  };

  const home = telemetry.home_lat != null && telemetry.home_lon != null
    && (Number(telemetry.home_lat) !== 0 || Number(telemetry.home_lon) !== 0)
    ? { lat: telemetry.home_lat, lon: telemetry.home_lon }
    : UGM_HOME;
  const vehicleHeading = Number(telemetry.heading ?? telemetry.yaw);
  const mapBearing = followVehicle && Number.isFinite(vehicleHeading)
    ? ((360 - vehicleHeading % 360) % 360)
    : 0;

  return (
    <div className="gcs-shell flex h-[100dvh] flex-col bg-slate-950 text-slate-100">
      <ConnectionBar
        socketConnected={socketConnected}
        vehicleConnected={vehicleConnected}
        armed={telemetry.armed}
        flightMode={telemetry.flight_mode}
        commandBusy={busy}
        onCommand={executeCommand}
      />
      {toast && (
        <div className={`fixed right-4 top-20 z-[1200] flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl ${toast.type === 'safety' ? 'border-orange-700 bg-orange-950 text-orange-100' : toast.type === 'error' ? 'border-red-800 bg-red-950 text-red-100' : 'border-slate-600 bg-slate-900 text-slate-100'}`} role={toast.type === 'error' || toast.type === 'safety' ? 'alert' : 'status'} aria-live="polite">
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="-mr-1 rounded px-1 text-slate-300 hover:bg-slate-800" aria-label="Dismiss notification">×</button>
        </div>
      )}

      <main className="gcs-workspace flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-4 xl:flex-row xl:overflow-hidden">
        <section className="gcs-map-column min-h-[460px] flex-[1_1_0%] xl:min-w-0">
          <MissionMap
            waypoints={waypoints}
            home={home}
            uav={{ lat: telemetry.lat, lon: telemetry.lon, yaw: telemetry.yaw, heading: telemetry.heading }}
            trail={trail}
            addingWaypoint={addingWaypoint}
            followVehicle={followVehicle}
            mapBearing={mapBearing}
            resetViewKey={mapResetKey}
            activeWaypointIndex={missionProgress?.active_waypoint}
            onMapClick={addWaypoint}
          />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>{addingWaypoint ? 'Click the map to add a waypoint.' : 'Select “Add Point”, then click the map to add a waypoint.'}</span>
            <span><b className="text-sky-300">H</b> Home · <b className="text-sky-300">▲</b> vehicle · flight path · mission route</span>
          </p>
        </section>
        <aside className="gcs-side-column w-full shrink-0 space-y-3 sm:space-y-4 xl:w-[20rem] xl:overflow-y-auto xl:pr-1">
          <div className="grid grid-cols-2 items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-lg sm:gap-3 sm:p-3">
            <AttitudeIndicator roll={-telemetry.roll} pitch={telemetry.pitch} size={124} />
            <Compass bearing={mapBearing} size={124} showButton={false} />
          </div>
          <TelemetryPanel telemetry={telemetry} lastUpdate={lastUpdate} />
          <MissionPanel
            waypoints={waypoints}
            missions={missions}
            selectedMissionId={selectedMissionId}
            missionName={missionName}
            missionProgress={missionProgress}
            missionRunState={missionRunState}
            navigationGuidance={navigationGuidance}
            addingWaypoint={addingWaypoint}
            followVehicle={followVehicle}
            busy={busy}
            onSelectMission={selectMission}
            onMissionNameChange={setMissionName}
            onSaveMission={saveMission}
            onUpload={uploadMission}
            onStart={startMission}
            onMissionControl={missionControl}
            onDeleteMission={deleteMission}
            onClearLocal={resetMap}
            onClearVehicle={clearVehicleMission}
            onToggleAddWaypoint={() => setAddingWaypoint((value) => !value)}
            onDownload={downloadMission}
            onToggleFollow={() => setFollowVehicle((value) => !value)}
            onUpdateAlt={updateAltitude}
            onRemove={removeWaypoint}
          />
          <FlightLogPanel />
        </aside>
      </main>
    </div>
  );
}
