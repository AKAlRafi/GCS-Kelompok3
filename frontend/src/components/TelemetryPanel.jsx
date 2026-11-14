import { useEffect, useState } from 'react';

const format = (value, digits = 1) => {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number)
    ? '—'
    : number.toFixed(digits);
};

const labels = {
  lat: ['Latitude', 7, '°'],
  lon: ['Longitude', 7, '°'],
  rel_alt: ['Relative Altitude', 1, 'm'],
  alt: ['Altitude AMSL', 1, 'm'],
  groundspeed: ['Ground Speed', 1, 'm/s'],
  airspeed: ['Air Speed', 1, 'm/s'],
  heading: ['Heading', 1, '°'],
  roll: ['Roll', 1, '°'],
  pitch: ['Pitch', 1, '°'],
  yaw: ['Yaw', 1, '°'],
  battery_percent: ['Battery', 0, '%'],
  gps_fix_type: ['GPS Fix', 0, ''],
  satellites_visible: ['Satellites', 0, ''],
  hdop: ['HDOP', 1, ''],
};

export default function TelemetryPanel({ telemetry, lastUpdate }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const isStale = !lastUpdate || now - lastUpdate > 3000;
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-lg">
      <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
        <h2 className="text-sm font-bold tracking-wide text-white">Telemetry</h2>
        <span className={`rounded-md border px-2.5 py-1 text-[10px] font-bold tracking-wider ${isStale ? 'border-slate-600 bg-slate-800 text-slate-400' : 'border-sky-700 bg-sky-950 text-sky-300'}`}>
          {isStale ? 'NO DATA' : 'LIVE'}
        </span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
        <span className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-400">Mode <b className="ml-1 text-slate-100">{telemetry.flight_mode || '—'}</b></span>
        <span className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-400">Status <b className={`ml-1 ${telemetry.armed ? 'text-orange-300' : 'text-slate-100'}`}>{telemetry.armed == null ? '—' : telemetry.armed ? 'ARMED' : 'DISARMED'}</b></span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(labels).map(([key, [label, digits, unit]]) => (
          <div key={key} className="rounded-lg border border-slate-700 bg-slate-800 p-3 transition-colors hover:border-slate-600">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
            <p className="mt-1 font-mono text-base font-semibold text-slate-50 tabular-nums">
              {format(telemetry[key], digits)}<span className="ml-1 text-[10px] text-slate-400">{unit}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

