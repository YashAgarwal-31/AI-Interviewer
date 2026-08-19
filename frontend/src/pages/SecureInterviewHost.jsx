import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import HomePage from './HomePage.jsx'

const LEGACY_HYDRATION_WINDOW_MS = 15000

export default function SecureInterviewHost() {
  const [hasSession] = useState(() => {
    // Clear any stale credential left behind by an interrupted previous mount.
    localStorage.removeItem('interviewSession')

    const session = sessionStorage.getItem('interviewSession')
    if (!session) return false

    // HomePage is a large legacy component that still reads this single key from
    // localStorage after its backend health check. Mirror the tab-scoped session
    // only for a bounded hydration window, then remove it automatically.
    localStorage.setItem('interviewSession', session)
    return true
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.removeItem('interviewSession')
    }, LEGACY_HYDRATION_WINDOW_MS)

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
