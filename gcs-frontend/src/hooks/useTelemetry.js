// penghubung data dari backend dan tampilan react, terima dan kelola
// pengelolaan telemetry agar bisa ditampilkan 
import {useEffect, useState } from 'react';
import {socket} from'../services/socket';

//data posisi attitude awal
const EMPTY ={
    lat: null,
    lon: null,
    alt: null,
    roll: 0,
    pitch: 0,
    yaw: 0,
    groundspeed: null,
};

//menyimpan data yang berubah 
export default function useTelemetry(){
    const [telemetry, setTelemetry] = useState(EMPTY); //posisi koreksi
    const [socketConnected, setSocketConnected] = useState(false); //koneksi to BE active?
    const [lastUpdate, setLastUpdate] = useState(null); //when last data recieved
    
    //memantau koneksi dan menerima data
    useEffect(() => {
        const onConnect = () => setSocketConnected(true);    
        const onDisconnet = () => setSocketConnectted(false);

        const onTelemetry = (payload) => { //gabungan data lama dan baru
            setTelemetry((prey) => ({...preview, ...payload}));
            setLastUpdate(Date.now());
        };
    
    //daftarkan event socket
    socket.on('connect', onConnect);
    socket.on('telemetry', ontelemetry);
    socket.on('disconnect', onDisconnect);

return () => {
    //cleanup data lama by react saat hook dilepas
    //putus koneksi
    socket.off();
    socket.off();
    socket.off();
    socket.disconnect();
    
    };
  }, []);

  //komponen react lain bisa memakai data 
  return { telemetry, socketConnected, lastUpdate };
}






