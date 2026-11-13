export default function ConnectionBar({
  socketConnected,
  vehicleConnected,
  armed,
  flightMode,
  commandBusy,
  onCommand,
}) {
  const controlsEnabled = vehicleConnected && socketConnected && !commandBusy;

  return (
    <header className="sticky top-0 z-[1000] flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-slate-700 bg-slate-900 px-4 py-3 shadow-lg">
      <h1 className="text-base font-bold tracking-[0.12em]">GCS <span className="text-sky-400">PANEL KENDALI</span></h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
        <Status label="Server" ok={socketConnected} />
        <Status label="Wahana" ok={vehicleConnected} />
        <span>Mode: <b className="text-white">{flightMode || '—'}</b></span>
        <span>Status: <b className={armed ? 'text-orange-300' : 'text-slate-400'}>{armed == null ? '—' : armed ? 'ARMED' : 'DISARMED'}</b></span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 p-1.5">
        {armed
          ? <button disabled={!controlsEnabled} onClick={() => onCommand('disarm')} className={buttonClass('bg-red-800 hover:bg-red-700')}>Disarm</button>
          : <button disabled={!controlsEnabled} onClick={() => onCommand('arm')} className={buttonClass('bg-orange-700 hover:bg-orange-600')}>Arm</button>}
        <button disabled={!controlsEnabled} onClick={() => onCommand('takeoff', { altitude_m: 10 })} className={buttonClass('bg-slate-700 hover:bg-slate-600')}>Takeoff 10 m</button>
        <button disabled={!controlsEnabled} onClick={() => onCommand('land')} className={buttonClass('bg-slate-700 hover:bg-slate-600')}>Mendarat</button>
        <button disabled={!controlsEnabled} onClick={() => onCommand('rtl')} className={buttonClass('bg-orange-800 hover:bg-orange-700')}>RTL</button>
      </div>
    </header>
  );
}

function buttonClass(color) {
  return `rounded-md border border-slate-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-110 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-40 ${color}`;
}

function Status({ label, ok }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full border border-slate-500 ${ok ? 'bg-sky-400' : 'bg-slate-600'}`} />
      <span className="text-slate-400">{label}</span><b className={ok ? 'text-sky-300' : 'text-slate-500'}>{ok ? 'TERHUBUNG' : 'TERPUTUS'}</b>
    </span>
  );
}
