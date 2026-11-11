import {useEffect, useState } from 'react';
import {socket} from'../services/socket';

const EMPTY ={
    lat: null,
    lon: null,
    alt: null,
    roll: 0,
    pitch: 0,
    yaw: 0,
    groundspeed: null,
};

export default function useTelemetry(){
    const [telemetry, setTelemetry] = useState(EMPTY);
    const [socketConnected, setSocketConnected] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);

    useEffect(() => {
        const onConnect = () => setSocketConnected(true);    
        const onDisconnet = () => setSocketConnectted(false);

        const onTelemetry = (payload) => {
            setTelemetry((prey) => ({...preview, ...payload}));
            setLastUpdate(Date.now());
        };
    socket.on('connect', onConnect);
    socket.on('telemetry', ontelemetry);
    socket.on('disconnect', onDisconnect);

return () => {
    socket.off();
    socket.off();
    socket.off();
    socket.disconnect();
    
    };
  }, []);

  return { telemetry, socketConnected, lastUpdate };
}






