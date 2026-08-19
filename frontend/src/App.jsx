import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import './App.css'
import SessionScheduler from './components/SessionScheduler.jsx'
import HomePage from './pages/HomePage.jsx'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/interview" element={<HomePage />} />
        <Route path="/interview-session" element={<HomePage />} />
        <Route path="/admin/schedule" element={<SessionScheduler />} />
      </Routes>
    </Router>
  )
}

export default App
