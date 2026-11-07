import React from 'react'
import './GeomanTools.css'

const GeomanTools = ({ mapInstance }) => {
  return (
    <div className='geoman'>
      <button onClick={() => mapInstance.current?.pm.enableDraw("Marker")}>Waypoint</button>

      <button onClick={() => mapInstance.current?.pm.enableDraw("Polygon")}>Polygon</button>

      <button onClick={() => mapInstance.current?.pm.enableDraw("Rectangle")}>Rectangle</button>

      <button onClick={() => mapInstance.current?.pm.enableDraw("Circle")}>Circle</button>

      <button onClick={() => mapInstance.current?.pm.disableDraw()}>Stop</button>
    </div>
  )
}

export default GeomanTools