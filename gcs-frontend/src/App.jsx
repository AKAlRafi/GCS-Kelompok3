// menyimpan data wp
// mengatur status uav, ambil data telemetry dan sicket dari usetele
// integrating
import {useState} from 'react';
import useTelemetry from './hooks/useTelemetry';
import { newId } from './utils/waypoints';

import ConnectionBar from './components/ConnectionBar';
import MissionMap from './components/MissionMap';
import MissionPanel from './components/MissionPanel';
import TelemetryPanel from './components/TelemetryPanel';
import FlightLogPanel from './components/FlightLogPanel';
import AttitudeIndicator from './components/AttitudeIndicator';

export default function App() {
  // state utama simpan daftar wp dan status uav
  const [waypoints, setWaypoints] = useState([]);
  const [uavConnected, setUavConnected] = useState(false);

  // 2. MENGAMBIL DATA TELEMETRY
  const {
    telemetry,
    socketConnected,
    lastUpdate,
  } = useTelemetry();

  // 3. FUNGSI PENGELOLAAN WAYPOINT

  // Mengubah altitude waypoint
  const updateAlt = (id, alt) => {
    setWaypoints((prev) =>
      prev.map((wp) =>
        wp.id === id ? { ...wp, alt } : wp
      )
    );
  };

  // Menghapus waypoint
  const removeWaypoint = (id) => {
    setWaypoints((prev) =>
      prev.filter((wp) => wp.id !== id)
    );
  };

  // 4. MENAMPILKAN SELURUH KOMPONEN
  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">

      {/* Bagian atas */}
      <ConnectionBar
        uavConnected={uavConnected}
        setUavConnected={setUavConnected}
        socketConnected={socketConnected}
      />

      {/* Bagian utama */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row">

        {/* Area peta */}
        <section className="min-h-[420px] flex-1">
          <MissionMap
            waypoints={waypoints}
            uav={{
              lat: telemetry.lat,
              lon: telemetry.lon,
              yaw: telemetry.yaw,
            }}
          />
        </section>

        {/* Area panel kanan */}
        <aside className="w-full shrink-0 space-y-3 lg:w-96">

          {/* Indikator orientasi */}
          <div className="flex justify-center rounded-lg border border-slate-700 bg-slate-900 p-3">
            <AttitudeIndicator
              roll={telemetry.roll}
              pitch={telemetry.pitch}
            />
          </div>

          {/* Data telemetry */}
          <TelemetryPanel
            telemetry={telemetry}
            lastUpdate={lastUpdate}
          />

          {/* Daftar waypoint */}
          <MissionPanel
            waypoints={waypoints}
            onUpdateAlt={updateAlt}
            onRemove={removeWaypoint}
          />

          {/* Pencatatan simulasi */}
          <FlightLogPanel />

        </aside>
      </main>
    </div>
  );
}

