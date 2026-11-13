export default function MissionPanel({
  waypoints = [],
  missions = [],
  selectedMissionId = '',
  missionName = '',
  missionProgress,
  missionRunState = 'idle',
  navigationGuidance,
  addingWaypoint,
  followVehicle,
  busy,
  onSelectMission,
  onMissionNameChange,
  onSaveMission,
  onUpload,
  onStart,
  onMissionControl,
  onDeleteMission,
  onClearLocal,
  onClearVehicle,
  onToggleAddWaypoint,
  onLoadUgmPreset,
  onToggleFollow,
  onUpdateAlt,
  onRemove,
}) {
  const selectedMission = missions.find((mission) => String(mission.id) === String(selectedMissionId));
  const running = missionRunState === 'running';
  const paused = missionRunState === 'paused';

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
      <div className="border-b border-slate-700 pb-3">
        <h2 className="text-sm font-bold tracking-wide text-slate-100">Perencanaan Misi</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Atur titik rute, simpan, lalu upload misinya ke drone.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onToggleAddWaypoint} className={`${buttonClass} ${addingWaypoint ? 'border-sky-500 text-sky-300' : ''}`}>
          {addingWaypoint ? 'Selesai Tambah Titik' : 'Tambah Titik'}
        </button>
        <button onClick={onToggleFollow} className={`${buttonClass} ${followVehicle ? 'border-sky-500 text-sky-300' : ''}`}>
          {followVehicle ? 'Ikuti Drone: Aktif' : 'Ikuti Drone'}
        </button>
        <button onClick={onLoadUgmPreset} className={`${buttonClass} col-span-2`}>
          Preset Rute UGM
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded bg-slate-800">
        {waypoints.length === 0 ? (
          <p className="p-3 text-center text-xs text-slate-500">Belum ada titik rute.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
              <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Lintang, bujur</th><th className="p-2 text-center">Alt. (m)</th><th /></tr>
            </thead>
            <tbody>
              {waypoints.map((waypoint, index) => (
                <tr key={waypoint.id} className="border-t border-slate-700 transition-colors hover:bg-slate-700">
                  <td className="p-2">{index + 1}</td>
                  <td className="p-2 font-mono tabular-nums">{Number(waypoint.lat).toFixed(5)}, {Number(waypoint.lon).toFixed(5)}</td>
                  <td className="p-2 text-center">
                    <input type="number" min="1" max="120" value={waypoint.alt}
                      onChange={(event) => onUpdateAlt(waypoint.id, Number(event.target.value))}
                      className="w-16 rounded bg-slate-700 px-1 py-1 text-right text-white" />
                  </td>
                  <td className="p-2 text-center">
                    <button onClick={() => onRemove(waypoint.id)} className="rounded px-2 text-slate-400 hover:bg-slate-700 hover:text-white" title="Hapus titik rute" aria-label={`Hapus titik rute ${index + 1}`}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">{waypoints.length} titik rute</p>

      <div className="space-y-2 border-t border-slate-700 pt-3">
        <label className="block text-xs text-slate-400" htmlFor="mission-name">Nama Misi</label>
        <input id="mission-name" value={missionName} onChange={(event) => onMissionNameChange(event.target.value)}
          placeholder="Contoh: Rute simulasi" maxLength={80}
          className="w-full rounded bg-slate-800 px-2 py-2 text-sm text-white placeholder:text-slate-500" />
        <label className="block text-xs text-slate-400" htmlFor="saved-mission">Misi Tersimpan</label>
        <select id="saved-mission" value={selectedMissionId} onChange={(event) => onSelectMission(event.target.value)}
          className="w-full rounded bg-slate-800 px-2 py-2 text-sm text-white">
          <option value="">Pilih misi</option>
          {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.name} ({mission.waypoint_count} titik)</option>)}
        </select>
        {selectedMission && <p className="text-xs text-slate-400">Panjang rute: {Number(selectedMission.total_distance_m || 0).toFixed(1)} m</p>}
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy || !selectedMissionId} onClick={onUpload} className={primaryButtonClass}>Upload Misi</button>
          {running ? (
            <button disabled={busy || !selectedMissionId} onClick={() => onMissionControl('pause_mission')} className={primaryButtonClass}>Jeda</button>
          ) : paused ? (
            <button disabled={busy || !selectedMissionId} onClick={() => onMissionControl('resume_mission')} className={primaryButtonClass}>Lanjutkan</button>
          ) : (
            <button disabled={busy || !selectedMissionId} onClick={onStart} className={primaryButtonClass}>Mulai Misi</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-700 pt-3">
          <button disabled={busy || waypoints.length === 0} onClick={onSaveMission} className={compactButtonClass}>Simpan Misi</button>
          <button disabled={busy} onClick={onClearLocal} className={compactButtonClass}>Reset Peta</button>
          {selectedMissionId && <button disabled={busy} onClick={onDeleteMission} className={compactButtonClass}>Hapus Misi</button>}
        </div>
        <details className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-300">Lainnya</summary>
          <button disabled={busy} onClick={onClearVehicle} className={`${compactButtonClass} mt-2 w-full`}>
            Hapus Misi di Drone
          </button>
        </details>
      </div>

      {(missionProgress || navigationGuidance) && (
        <div className="space-y-1 rounded bg-slate-800 p-2 text-xs text-slate-300">
          {missionProgress && <p>Status misi: <b className="text-white">{missionStageLabel(missionProgress.stage)}</b>{missionProgress.active_waypoint != null ? ` · titik ${Number(missionProgress.active_waypoint) + 1}` : ''}</p>}
          {navigationGuidance && <p>Ke titik berikutnya: {navigationGuidance.distance_m} m · arah {navigationGuidance.bearing_deg}°</p>}
        </div>
      )}
    </section>
  );
}

const buttonClass = 'rounded-md border border-slate-600 bg-slate-800 px-2.5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:border-slate-500 hover:bg-slate-700 active:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40';
const primaryButtonClass = 'rounded-md border border-sky-500 bg-sky-700 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-sky-600 active:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-40';
const compactButtonClass = 'rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

function missionStageLabel(stage) {
  const labels = {
    PRE_ARM: 'Cek Pra-terbang',
    ARMING: 'Arm',
    TAKING_OFF: 'Takeoff',
    STARTING_MISSION: 'Memulai Misi',
    NAVIGATING_WAYPOINT: 'Menuju Titik',
    RETURNING_HOME: 'Kembali ke Home',
    LANDING: 'Landing',
    EXECUTING_ACTION: 'Menjalankan Aksi',
    COMPLETED: 'Selesai',
  };
  return labels[stage] || stage || '—';
}
