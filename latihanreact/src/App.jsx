import React from 'react'
import {Routes, Route} from 'react-router-dom'
import { Plan } from './Pages/Plan'

const App = () => {
  return (
    <Routes>
        <Route path='/' element={<Plan/>}/>
    </Routes>
  )
}

export default App