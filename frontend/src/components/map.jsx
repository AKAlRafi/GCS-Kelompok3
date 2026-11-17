import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export default function Map() {
  const position = [-7.7709174, 110.3791232];

  const styles = {
    map: {
      height: '100vh',
      width: '100%'
    }
  };

  return (
    <MapContainer 
      style={styles.map}
      center={position} 
      zoom={15}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={position}>
        <Popup>
          A sample marker popup.
        </Popup>
      </Marker>
    </MapContainer>
  );
}
