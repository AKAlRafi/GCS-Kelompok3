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
    setToast({ type: 'safety', message: failsafeWarning.message || failsafeWarning.reason || 'Peringatan failsafe.' });
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
      if (active) setToast({ type: 'error', message: requestError.response?.data?.error || 'Daftar misi gagal dimuat.' });
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
      setToast({ type: 'error', message: requestError.response?.data?.error || requestError.message || 'Permintaan gagal.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const executeCommand = (type, payload = {}) => {
    const labels = { arm: 'Perintah ARM dikirim.', disarm: 'Perintah DISARM dikirim.', takeoff: 'Perintah Takeoff dikirim.', land: 'Perintah mendarat dikirim.', rtl: 'Perintah RTL dikirim.' };
    return runAction(() => commandApi.send(type, payload), labels[type] || 'Perintah dikirim.');
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
      setToast({ type: 'error', message: 'Tambahkan titik rute sebelum menyimpan misi.' });
      return;
    }
    const route = waypoints.map((waypoint, index) => ({
      lat: Number(waypoint.lat),
      lon: Number(waypoint.lon),
      alt: Number(waypoint.alt),
      command: Number(waypoint.command ?? (index === 0 ? 22 : 16)),
    }));
    const result = await runAction(
      () => missionApi.create({ name: missionName.trim() || 'Rute GCS', waypoints: route }),
      'Misi tersimpan.',
    );
    if (result?.mission) {
      setSelectedMissionId(String(result.mission.id));
      setMissionName(result.mission.name);
      await refreshMissions().catch(() => {});
    }
  };

  const uploadMission = () => runAction(
    () => missionApi.upload(selectedMissionId),
    'Misi berhasil di-upload ke drone.',
  );

  const startMission = async () => {
    const result = await runAction(() => missionApi.start(selectedMissionId), 'Misi dimulai.');
    if (result) setMissionRunState('running');
  };

  const missionControl = async (type) => {
    const result = await runAction(
      () => missionApi.control(type),
      type === 'pause_mission' ? 'Misi dijeda.' : 'Misi dilanjutkan.',
    );
    if (result) setMissionRunState(type === 'pause_mission' ? 'paused' : 'running');
  };

  const deleteMission = async () => {
    const result = await runAction(() => missionApi.remove(selectedMissionId), 'Misi tersimpan dihapus.');
    if (!result) return;
    setSelectedMissionId('');
    setWaypoints([]);
    setMissionName('');
    await refreshMissions().catch(() => {});
  };

  const clearVehicleMission = () => runAction(
    () => missionApi.clearFromVehicle(),
    'Misi di drone berhasil dikosongkan.',
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

  const loadUgmPreset = () => {
    setSelectedMissionId('');
    setMissionName('Preset patroli UGM');
    setWaypoints([
      { id: newId(), lat: -7.7699, lon: 110.3768, alt: 10 },
      { id: newId(), lat: -7.7701, lon: 110.3781, alt: 10 },
      { id: newId(), lat: -7.7712, lon: 110.3777, alt: 10 },
      { id: newId(), lat: -7.7710, lon: 110.3765, alt: 10 },
    ]);
    setToast({ type: 'success', message: 'Preset Rute UGM siap. Cek titiknya sebelum di-upload.' });
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
          <button type="button" onClick={() => setToast(null)} className="-mr-1 rounded px-1 text-slate-300 hover:bg-slate-800" aria-label="Tutup notifikasi">×</button>
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
            resetViewKey={mapResetKey}
            activeWaypointIndex={missionProgress?.active_waypoint}
            onMapClick={addWaypoint}
          />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>{addingWaypoint ? 'Klik peta untuk menaruh titik rute.' : 'Pilih “Tambah Titik”, lalu klik peta untuk menaruh titik rute.'}</span>
            <span><b className="text-sky-300">H</b> Home · <b className="text-sky-300">▲</b> drone · jejak penerbangan · rute misi</span>
          </p>
        </section>

        <aside className="gcs-side-column w-full shrink-0 space-y-3 sm:space-y-4 xl:w-[26rem] xl:overflow-y-auto xl:pr-1">
          <div className="flex justify-center rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-lg sm:p-4">
            <AttitudeIndicator roll={telemetry.roll} pitch={telemetry.pitch} />
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
            onLoadUgmPreset={loadUgmPreset}
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
