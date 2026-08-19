import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import HomePage from './HomePage.jsx'

export default function SecureInterviewHost() {
  const [hasSession] = useState(() => {
    const session = sessionStorage.getItem('interviewSession')
    if (!session) return false

    // HomePage is a large legacy component that still reads this single key from
    // localStorage. Mirror it only for initial hydration, then remove immediately.
    // The durable credential remains tab-scoped in sessionStorage.
    localStorage.setItem('interviewSession', session)
    return true
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.removeItem('interviewSession')
    }, 1000)
    return () => {
      window.clearTimeout(timer)
      localStorage.removeItem('interviewSession')
    }
  }, [])

  if (!hasSession) {
    return <Navigate to="/" replace state={{ message: 'Open the complete secure interview link sent by your recruiter.' }} />
  }

  return <HomePage />
}
