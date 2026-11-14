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
  onToggleFollow,
  onUpdateAlt,
  onRemove,
  onDownload,
}) {
  const selectedMission = missions.find((mission) => String(mission.id) === String(selectedMissionId));
  const running = missionRunState === 'running';
  const paused = missionRunState === 'paused';

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
      <div className="border-b border-slate-700 pb-3">
        <h2 className="text-sm font-bold tracking-wide text-slate-100">Mission Planner</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Add route points, save the mission, then upload it to the drone.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onToggleAddWaypoint} className={`${buttonClass} ${addingWaypoint ? 'border-sky-500 text-sky-300' : ''}`}>
          {addingWaypoint ? 'Finish Adding Points' : 'Add Point'}
        </button>
        <button onClick={onToggleFollow} className={`${buttonClass} ${followVehicle ? 'border-sky-500 text-sky-300' : ''}`}>
          {followVehicle ? 'Follow Drone: On' : 'Follow Drone'}
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded bg-slate-800">
        {waypoints.length === 0 ? (
          <p className="p-3 text-center text-xs text-slate-500">No route points yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
              <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Latitude, longitude</th><th className="p-2 text-center">Alt. (m)</th><th /></tr>
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
                    <button onClick={() => onRemove(waypoint.id)} className="rounded px-2 text-slate-400 hover:bg-slate-700 hover:text-white" title="Remove route point" aria-label={`Remove route point ${index + 1}`}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">{waypoints.length} route points</p>

      <div className="space-y-2 border-t border-slate-700 pt-3">
        <label className="block text-xs text-slate-400" htmlFor="mission-name">Mission name</label>
        <input id="mission-name" value={missionName} onChange={(event) => onMissionNameChange(event.target.value)}
          placeholder="e.g. Test route" maxLength={80}
          className="w-full rounded bg-slate-800 px-2 py-2 text-sm text-white placeholder:text-slate-500" />
        <label className="block text-xs text-slate-400" htmlFor="saved-mission">Saved missions</label>
        <select id="saved-mission" value={selectedMissionId} onChange={(event) => onSelectMission(event.target.value)}
          className="w-full rounded bg-slate-800 px-2 py-2 text-sm text-white">
          <option value="">Select a mission</option>
          {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.name} ({mission.waypoint_count} points)</option>)}
        </select>
        {selectedMission && <p className="text-xs text-slate-400">Route length: {Number(selectedMission.total_distance_m || 0).toFixed(1)} m</p>}
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy || !selectedMissionId} onClick={onUpload} className={primaryButtonClass}>Upload Mission</button>
          {running ? (
            <button disabled={busy || !selectedMissionId} onClick={() => onMissionControl('pause_mission')} className={primaryButtonClass}>Pause</button>
          ) : paused ? (
            <button disabled={busy || !selectedMissionId} onClick={() => onMissionControl('resume_mission')} className={primaryButtonClass}>Resume</button>
          ) : (
            <button disabled={busy || !selectedMissionId} onClick={onStart} className={primaryButtonClass}>Start Mission</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-700 pt-3">
          <button disabled={busy || waypoints.length === 0} onClick={onSaveMission} className={compactButtonClass}>Save Mission</button>
          <button disabled={busy} onClick={onClearLocal} className={compactButtonClass}>Reset Map</button>
          {selectedMissionId && <button disabled={busy} onClick={onDeleteMission} className={compactButtonClass}>Delete Mission</button>}
          {selectedMissionId && <button disabled={busy} onClick={onDownload} className={compactButtonClass}>Download .waypoints</button>}
        </div>
        <details className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">More</summary>
          <button disabled={busy} onClick={onClearVehicle} className={`${compactButtonClass} mt-2 w-full`}>
            Clear Mission on Drone
          </button>
        </details>
      </div>

      {(missionProgress || navigationGuidance) && (
        <div className="space-y-1 rounded bg-slate-800 p-2 text-xs text-slate-300">
          {missionProgress && <p>Mission: <b className="text-white">{missionStageLabel(missionProgress.stage)}</b>{missionProgress.active_waypoint != null ? ` · point ${Number(missionProgress.active_waypoint) + 1}` : ''}</p>}
          {navigationGuidance && <p>Next point: {navigationGuidance.distance_m} m · heading {navigationGuidance.bearing_deg}°</p>}
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
    PRE_ARM: 'Pre-flight check',
    ARMING: 'Arm',
    TAKING_OFF: 'Takeoff',
    STARTING_MISSION: 'Starting mission',
    NAVIGATING_WAYPOINT: 'Navigating to point',
    RETURNING_HOME: 'Returning home',
    LANDING: 'Landing',
    EXECUTING_ACTION: 'Executing action',
    COMPLETED: 'Completed',
  };
  return labels[stage] || stage || '—';
}
