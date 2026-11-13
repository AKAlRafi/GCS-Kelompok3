// menampilkan informasi log pencatatan data 
import {useState} from 'react';
//usestate untuk informasi dinamis
export default function FlightLogPanel() {
    const [recording, setReccording] = useState(false); //jalan atau tidak
    const [currentFile, setCurrentFile] = useState(null); //simpan nama sesi on going 
    const [logs, setLogs] = useState([]); //yg sudah selesai

    //start stop pencatatan simulasi 
    const toggleRecording = () => {
        if(!recording) {
            const filename =`simulation${Date.now()}.log`; //nama sesi keadaan terbaru 

            setCurrentFile(filename);
            setReccording(true); //ubah status
        } else { 
            const newLog = { //objek baru
                id: Date.now(),
                filename: currentFile,
                startedAt: new Date().toLocaleString('id-ID'), 
            };

            setLogs((prev) => [newLog, ...prev]); //sesi terbaru paling atas
            
            setCurrentFile(null); //kembalikan status
            setReccording(false);
        }
    };

    return (
        <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-3">

            {/*judul and status*/}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                    Flight Log (Simulation)
                </h2>

                {recording && (
                    <span className="flex items-center gap-1.5 text-xs text-red-400">
                        <span className="h-2.5 w-3.5 animate-pulse rounded-full bg-red-500"
                        >
                            REC {/*muncul ketika recording true*/}
                        </span>
                        
                    </span>
                )}
            </div>

            {/*button start stop*/}
            <button 
            onClick={toggleRecording}
            className={`w-full rounded px-3 py-2 text-sm font-semibold text-white ${
                recording
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-green-600 hover:bg-green-500'
            }`}
        > 
        {recording ? 'Stop simulation' : 'Start simulation'}
        </button> 

        {/*informasi sesi saat ini*/}
        {recording && currentFile && (
            <p className="truncate text-xs text-slate-400">
                Sesi aktif : {currentFile}
            </p>
        )}

        {/*history pencatatan*/}
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">
                    Riwayat simulasi 
                </span>

                <span className="text-xs text-slate-500">
                    {logs.length} sesi
                </span>
            </div>
            
            <ul className="max h-40 space-y-1 overflow-y-auto">

                {logs.length === 0 ? (
                    <li className="text-xs text-slate-500">
                        Belum ada riwayat simulasi.
                    </li>
                ) : (
                    logs.map((log) => (
                        <li 
                          key={log.id}
                          className="rounded bg-slate-800 px-2 py-2 text-xs"
                        > 
                        <div className="truncate font-mono text-slate-200">
                            {log.filename}
                        </div>

                            <div className="mt-1 text-slate-500">
                                {log.startedAt}
                            </div>
                        </li>
                    ))
                )}
            </ul>
        </div>
        <p className="text-xs text-amber-400">
            Mode simulasi : tidak mereka data wahana atau membuat file log.
        </p>
        </section>
    );

}