import { useCallback, useEffect, useState } from 'react';

const normalizeHeading = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? ((number % 360) + 360) % 360 : null;
};

const cardinalDirection = (degrees) => {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(degrees / 45) % directions.length];
};

export default function Compass({
  bearing: mapBearing,
  size = 124,
  showButton = true,
  onHeadingChange,
  onPermissionChange,
  className = '',
  style = {},
  buttonText = 'Enable Device Compass',
}) {
  const [sensorHeading, setSensorHeading] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState('');
  const hasMapBearing = mapBearing !== null && mapBearing !== undefined
    && Number.isFinite(Number(mapBearing));
  const bearing = normalizeHeading(hasMapBearing ? mapBearing : sensorHeading) ?? 0;

  const handleOrientation = useCallback((event) => {
    let nextHeading = null;
    if (typeof event.webkitCompassHeading === 'number') {
      nextHeading = event.webkitCompassHeading;
    } else if (typeof event.alpha === 'number') {
      nextHeading = 360 - event.alpha;
    }
    if (nextHeading !== null) setSensorHeading(normalizeHeading(nextHeading));
  }, []);

  const requestAccess = async () => {
    setError('');
    try {
      if (typeof DeviceOrientationEvent === 'undefined') {
        throw new Error('Device orientation is not supported.');
      }
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('Permission denied for device orientation.');
      }
      setPermissionGranted(true);
      onPermissionChange?.(true);
    } catch (requestError) {
      setError(requestError.message || 'Unable to access device orientation.');
      onPermissionChange?.(false);
    }
  };

  useEffect(() => {
    if (!permissionGranted || hasMapBearing) return undefined;
    const eventName = 'ondeviceorientationabsolute' in window
      ? 'deviceorientationabsolute'
      : 'deviceorientation';
    window.addEventListener(eventName, handleOrientation, true);
    return () => window.removeEventListener(eventName, handleOrientation, true);
  }, [permissionGranted, hasMapBearing, handleOrientation]);

  useEffect(() => {
    onHeadingChange?.(bearing);
  }, [bearing, onHeadingChange]);

  const showCompass = hasMapBearing || permissionGranted || !showButton;

  return (
    <section
      className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-100 ${className}`}
      style={style}
      aria-label="Map compass"
    >
      <div className="flex w-full items-center justify-between gap-1">
        <h2 className="text-xs font-bold tracking-wide">Map Compass</h2>
        <span className="font-mono text-[10px] font-semibold tabular-nums text-sky-300">
          {bearing.toFixed(1)}° {cardinalDirection(bearing)}
        </span>
      </div>

      {showCompass ? (
        <div className="relative" style={{ width: size, height: size }}>
          <div className="absolute -top-1 left-1/2 z-10 h-0 w-0 -translate-x-1/2 border-x-[8px] border-t-[12px] border-x-transparent border-t-sky-400" />
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={`Map bearing ${bearing.toFixed(1)} degrees ${cardinalDirection(bearing)}`}
            className="h-full w-full transition-transform duration-150 ease-out"
            style={{ transform: `rotate(${bearing}deg)` }}
          >
            <circle cx="100" cy="100" r="95" fill="#0f172a" stroke="#475569" strokeWidth="4" />
            <g stroke="#94a3b8" strokeWidth="2">
              {Array.from({ length: 36 }, (_, index) => (
                <line
                  key={index}
                  x1="100"
                  y1={index % 3 === 0 ? '10' : '14'}
                  x2="100"
                  y2={index % 3 === 0 ? '22' : '19'}
                  transform={`rotate(${index * 10} 100 100)`}
                />
              ))}
            </g>
            <text x="100" y="40" textAnchor="middle" fontWeight="700" fill="#38bdf8">N</text>
            <text x="160" y="105" textAnchor="middle" fontWeight="600" fill="#cbd5e1">E</text>
            <text x="100" y="170" textAnchor="middle" fontWeight="600" fill="#cbd5e1">S</text>
            <text x="40" y="105" textAnchor="middle" fontWeight="600" fill="#cbd5e1">W</text>
            <circle cx="100" cy="100" r="4" fill="#e2e8f0" />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          onClick={requestAccess}
          className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold hover:bg-slate-700"
        >
          {buttonText}
        </button>
      )}

      {error && <p className="text-center text-xs text-rose-300">{error}</p>}
    </section>
  );
}
