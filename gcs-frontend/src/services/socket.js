// socket = mengatur koneksi terbuka terus tiap data baru
//realtime

//memungkinkan react sebagai klien socket
import{io} from'socket.io-client';
import{SOCKET_URL}from'../config';

//koneksi hold by use telemetry
export const socket = io(SOCKET_URL, {
    autoConnect: false,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
});


