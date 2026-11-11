import{io} from'socket.io-client';
import{SOCKET_URL}from'../comfig';

//koneksi by use telemetry
export const socket = io(SOCKET_URL, {
    autoConnect: false,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
});


