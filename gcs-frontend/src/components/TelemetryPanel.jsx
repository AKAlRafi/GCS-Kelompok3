// panel yang menampilkan data telemetri 
//mengatur format agar rapi 
const fmt = (value, digits = 2) =>
    value == null ||
    value == undefined ||
    Number.isNaN(Number(value))//number or not
        ? '-'
        : Number(value).toFixed(digits);
        
//menerima data yang sama dari hook use telemetry
export default function TelemetryPanel({
    telemetry,
    lastUpdate,
}) { //mendeteksi data lama 
    const isStale =
        !lastUpdate || Date.now() -lastUpdate > 3000;

    const items = [
      { 
        label: 'LATITUDE',
        value: fmt(telemetry.lat, 7),
        unit: '°',
      }, {
        label: 'LONGITUDE',
        value: fmt(telemetry.lon, 7),
        unit: '°',
      }, {
        label: 'ALTITUDE',
        value: fmt(telemetry.alt),
        unit: 'm',
      }, {
        label: 'GROUNDSPEED',
        value: fmt(telemetry.groundspeed),
        unit: 'm/s',
      }, {
        label: 'ROLL',
        value: fmt(telemetry.roll),
        unit: '°',
      }, {
        label: 'PITCH',
        value: fmt(telemetry.pitch),
        unit: '°',
      }, {
        label: 'YAW',
        value: fmt(telemetry.yaw),
        unit: '°',
      },
    ];
 
    return (
        <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <div className ="mb-4 flex items-center justify-between">
                <h2 className ="font-bold text-white">
                    Telemetry
                </h2>

                <span
                  className={`text-xs font semibold ${
                    isStale ? `text-amber-400` : `text-green-400`
                  }`}
                >
                  {isStale ? `DATA STALE` : `LIVE DATA`}         
                </span>
            </div>

            <div className="grid gird-cols-2 gap-3">
                {items.map((item) =>  ( //menampilkan data masing masing objek 
                    <div
                    key={item.label}
                    className="rounded-md bg-slate-800 p-3"
                 >
                    <p className="text-xs text-slate-400">
                        {item.label}
                    </p>

                    <p className="mt-1 font-mono text-lg font-bold text-white">
                        {item.value}
                        <span className="m1-1 text-xs text-slate-400">
                          {item.unit}
                        </span>
                    </p>
                </div>
                ))}
            </div>
        </section>
    );
}