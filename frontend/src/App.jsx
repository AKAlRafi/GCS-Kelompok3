import './App.css'
import Hud from './components/hud'
import Map from './components/map'
import Navbar from './components/navbar'

function App() {
  

  return (
    <div className="app-shell">
      <Navbar/>
      <main className="map-stage" id="main-map" aria-label="Flight map">
        <Map/>
        <Hud />
      </main>
    </div>
  )
}

export default App
