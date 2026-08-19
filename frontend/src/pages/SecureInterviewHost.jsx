import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import IntegrityEventBridge from '../components/IntegrityEventBridge.jsx'
import LiveInterviewPage from './LiveInterviewPage.jsx'

export default function SecureInterviewHost() {
  const [session] = useState(() => {
    const stored = sessionStorage.getItem('interviewSession')
    if (!stored) return null
    try {
      const parsed = JSON.parse(stored)
      if (!parsed?.sessionId || !parsed?.accessToken) return null
      return parsed
    } catch {
      sessionStorage.removeItem('interviewSession')
      return null
    }
  })

  if (!session) {
    return <Navigate to="/" replace state={{ message: 'Open the complete secure interview link sent by your recruiter.' }} />
  }

  return (
    <>
      <IntegrityEventBridge session={session} />
      <LiveInterviewPage session={session} />
    </>
  )
}