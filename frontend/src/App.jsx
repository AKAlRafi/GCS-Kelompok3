import './App.css'
import Hud from './components/hud'
import Map from './components/map'
import Navbar from './components/navbar'
import More from './components/more'

function App() {
  

  return (
    <div className="app-shell">
      <Navbar/>
      <More/>
      <main className="map-stage" id="main-map" aria-label="Flight map">
        <Map/>
        <Hud />
      </main>
    </div>
  )
}

export default App
