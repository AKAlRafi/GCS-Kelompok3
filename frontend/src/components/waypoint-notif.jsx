import { useEffect, useState } from 'react';
import { socket } from '../services/socket';
import './waypoint-notif.css';

export default function WaypointNotification() {
  const [notif, setNotif] = useState(null);

  useEffect(() => {
    let timer;
    const onWpReached = (data) => {
      if (!data) return;
      setNotif({
        seq: data.seq,
        time: new Date().toLocaleTimeString('id-ID'),
      });

      clearTimeout(timer);
      timer = setTimeout(() => {
        setNotif(null);
      }, 4000);
    };

    socket.on('waypoint_reached', onWpReached);
    return () => {
      clearTimeout(timer);
      socket.off('waypoint_reached', onWpReached);
    };
  }, []);

  if (!notif) return null;

  return (
    <div className='wp-container'>
      {notif.seq === 0
        ? `Home Position (WP #0) tercapai (${notif.time})`
        : `Waypoint ke-${notif.seq} tercapai (${notif.time})`}
    </div>
  );
}