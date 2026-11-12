// bagian peta pada gcs secara visual 
import L from 'leaflet'; //buat visual peta
import{
    MapContaiiner,
    TileLayer,
    Marker,
    Popup,
    MapContainer,
} from 'react-leaflet'; //peta-react
import 'leaflet/dist/leaflet.css'; //css bawaan 

//titik awal peta 
const default_center =[-7.6, 105];

//buat ikon waypoint dengan nomor
const waypointIcon = (number) =>
    L.divIconivIcon ({
        className: '',
        html: `
        <div class="flex h-7 w-7 items-center justify-center rounded-full border-white bg-blue-600 
        text-xs font-bold text-white shadow-lg">
        ${number}
        </div>
        `,
        iconSize: [28, 28,],
        iconAnchor: [14, 14],
    });

//icon uav segitiga
const uavIcon = (yaw) =>
    L.divIcon({
        className: '',
        html: `
        <div style="transform: rotate(${Number(yaw) || 0}deg)"
        class="flex h-6 w-6 utems-center justify-center
        text-2xxl leading-non text-amber-400">
        ▲
        </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    });

    export default function MissionMap ({ //wadah utama peta menerima data dari komponen induk
        waypoints =[],
        uav =[],
    }) {
        const hasUav =
         uav.lat != null && uav.lon != null;

        return (
            <div className="h-[420px w-full overflow-hidden rounder-lg border border-slate-700">
             <MapContainer
               center={default_center} //posisi awal
               zoom={13}
               className="h-full w-full" //ukuran peta mengikuti wadahnya 
            > 
            {/*peta dasar gambar*/}
            <TileLayer //mengambil potongan gambar dari openstreet
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                
                {/*marker waypoint lokasi*/ }
                 {waypoints.map((wp, index) => (
                    <Marker
                        key={wp.id}
                        position={[wp.lat, wp.lon]}
                        icon={waypointIcon(index + 1)}
                        >
                        <Popup>
                         <div>
                          <strong>Waypoint {index + 1}</strong>
                          <p>
                           Latitude: {wp.lat.toFixed(6)}
                          </p>
                          <p>
                           Longitude: {wp.lon.toFixed(6)}
                          </p>
                         </div>
                        </Popup>
                    </Marker>
                ))}

                {/*menampilkan posisi uav simulasi */}
                {hasUav && (
                    <Marker 
                    position={[uav.lat, uav.lon]}
                    icon={uavIcon(uav.yaw)}
                    interactive={false}
                    />
                )}    
            </MapContainer>
            </div>
        )
    
    }
