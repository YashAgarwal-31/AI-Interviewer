import { useEffect } from 'react'
import config from '../config'

const ALLOWED_TYPES = new Set([
  'no_face',
  'multiple_faces',
  'face_state_restored',
  'restricted_object_detected',
  'restricted_object_cleared',
  'sustained_loud_audio',
  'audio_level_restored',
  'monitoring_unavailable'
])

export default function IntegrityEventBridge({ session }) {
  useEffect(() => {
    if (!session?.sessionId || !session?.accessToken || session.recordingEnabled === false) return undefined

    let closed = false
    const handler = event => {
      const detail = event.detail
      if (closed || !detail || !ALLOWED_TYPES.has(detail.type)) return
      fetch(`${config.AI_BACKEND_URL}/api/sessions/message/${encodeURIComponent(session.sessionId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Interview-Token': session.accessToken
        },
        body: JSON.stringify({
          accessToken: session.accessToken,
          messageType: 'integrity_event',
          integrityEvent: detail
        })
      }).catch(error => console.debug('Integrity event delivery skipped:', error?.message))
    }

    window.addEventListener('interview-integrity-event', handler)
    return () => {
      closed = true
      window.removeEventListener('interview-integrity-event', handler)
    }
  }, [session])

  return null
}
