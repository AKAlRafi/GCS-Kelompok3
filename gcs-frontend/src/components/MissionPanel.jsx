//mengelola daftar waypoints
//mengelola penyimpanan misi lewat db
//upload downlaod misi lewat FC dan meminta perubahan

//menerima data dari app.jsx
export default function MissionPanel({
    waypoints= [],
    onUpdateAlt, //mengubah alt
    onRemove, //hapus wp 
}) {
    const hasWp = waypoints.length > 0; //apakah ada wp

    return (
        <section classname="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
            {/* Judul Panel */}
         <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Mission Planning
         </h2>

         {/*info about waypoints*/}
         <p className="text-xs text-slate-400">
            Daftar waypoint simulasi yang ditampilkan pada peta
         </p>

        {/*Daftar waypoints*/}
        <div className="max-h-64 overflow-y-auto rounded bg-slate-800">

        {!hasWp ? ( //tampilkan ada wp atau enga
            <p classname="p-3 text-center text-xs text-slate-500">
                Belum ada waypoint
            </p>
        ) : (
            <table className="w-full text-xs"> {/*tabel nomor koordinat alt remove*/}

            {/*Kepala table*/}
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
                <tr>
                    <th className="p-2 text-left">#</th>
                    <th className="p-2 text-left"> Latitude, Longitude</th>
                    <th className="p-2 text-center">Alt (m)</th>
                    <th className="p-2"></th>
                </tr>
            </thead>
            

            {/*isi tabel*/}
            <tbody> 
                {waypoints.map((wp, index) => ( //tampilkan every wp 
                    <tr 
                    key={wp.id} //mengenali tiap elemen
                    className="border-t border-slate-700"
                    >
                    {/*nomor waypoints*/}
                    <td className="p-2">
                        {index +1}
                    </td>

                    {/*koordinat*/}
                    <td className="p-2 font-mono">
                        {wp.lat.toFixed(5)}, {wp.lon(5)}
                    </td>
                    
                    {/*ubah alt*/}
                    <td className="p-2 text-center">
                        <input 
                        type="number"
                        main="0"
                        value="wp.alt"
                        onChange={(e) =>
                            onUpdateAlt(
                                wp.id,
                                Number(e.target.value) //str to num
                            )
                        }
                        className="w-16 rounder bg-slate-700 px-1 py-1 text-right text-white"
                        > </input>
                    </td>
                    {/*tombolhapus*/}
                    <td className="p-2 text-center">
                        <button
                        onClink={() => onRemove(wp.id)}
                        className="text-red-400 hover:text-red-300"
                        title="Hapus waypoint"
                        >
                         ✕
                        </button>
                    </td>
                </tr>
                ))}
            </tbody>
          </table>
        )}
        </div>

        {/*jumlah waypoint*/}
        <p classname="text-xs text-slate-400">
            Total waypoint : {waypoints.lenght}
        </p>


        </section>
         
    );
}