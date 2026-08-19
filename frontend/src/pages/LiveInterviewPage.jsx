import {
  Bot,
  Camera,
  CameraOff,
  CheckCircle2,
  Code2,
  Mic,
  MicOff,
  Send,
  Square,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AIAvatar3D from '../components/AIAvatar3D'
import VideoMonitor from '../components/VideoMonitor'
import config from '../config'

const CODING_TRIGGERS = [
  'coding test', 'code challenge', 'coding exercise', 'please write code', 'implement',
  'solve the problem', 'write a function', 'open the code editor', 'coding task', 'write code to'
]

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function trustedEditorOrigin() {
  try {
    return new URL(config.CODE_EDITOR_URL).origin
  } catch {
    return ''
  }
}

function historyToMessages(history = []) {
  return history
    .filter(item => item?.role !== 'system' && item?.content)
    .map((item, index) => ({
      id: `${item.role}-${item.timestamp || index}`,
      role: item.role === 'assistant' ? 'interviewer' : 'candidate',
      content: item.content,
      timestamp: item.timestamp || new Date().toISOString()
    }))
}

export default function LiveInterviewPage({ session }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState(false)
  const [result, setResult] = useState(null)
  const [secondsRemaining, setSecondsRemaining] = useState(null)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [stream, setStream] = useState(null)
  const [monitorError, setMonitorError] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [codingTasks, setCodingTasks] = useState([])
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [codeSubmitting, setCodeSubmitting] = useState(false)

  const streamRef = useRef(null)
  const recognitionRef = useRef(null)
  const messagesEndRef = useRef(null)
  const iframeRef = useRef(null)
  const endingRef = useRef(false)
  const codingStartedRef = useRef(false)
  const lastSpokenRef = useRef(-1)
  const editorOrigin = useMemo(trustedEditorOrigin, [])

  const apiRequest = useCallback(async (path, options = {}) => {
    const headers = new Headers(options.headers || {})
    if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
    headers.set('X-Interview-Token', session.accessToken)

    const response = await fetch(`${config.AI_BACKEND_URL}${path}`, { ...options, headers })
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid server response' }))
    if (!response.ok || data.success === false) {
      const requestId = response.headers.get('x-request-id') || data.requestId
      const suffix = requestId ? ` (request ${requestId})` : ''
      throw new Error(`${data.error || data.message || `Request failed (${response.status})`}${suffix}`)
    }
    return data
  }, [session.accessToken])

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop?.() } catch { /* no-op */ }
    recognitionRef.current = null
    setListening(false)
  }, [])

  const stopMonitoring = useCallback(() => {
    streamRef.current?.getTracks?.().forEach(track => track.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const speakText = useCallback((text) => {
    if (!voiceEnabled || !text || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-IN'
    utterance.rate = 0.95
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }, [voiceEnabled])

  const appendInterviewer = useCallback((content) => {
    if (!content) return
    setMessages(previous => [...previous, {
      id: `ai-${Date.now()}-${previous.length}`,
      role: 'interviewer',
      content,
      timestamp: new Date().toISOString()
    }])
  }, [])

  const initializeInterview = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const data = await apiRequest(`/api/sessions/initialize-interview/${encodeURIComponent(session.sessionId)}`, {
        method: 'POST',
        body: JSON.stringify({ accessToken: session.accessToken })
      })
      const restored = historyToMessages(data.interviewData?.conversationHistory)
      if (restored.length) setMessages(restored)
      else if (data.initialMessage) appendInterviewer(data.initialMessage)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiRequest, appendInterviewer, session.accessToken, session.sessionId])

  useEffect(() => { initializeInterview() }, [initializeInterview])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    const index = messages.length - 1
    const last = messages[index]
    if (index >= 0 && last?.role === 'interviewer' && index !== lastSpokenRef.current && voiceEnabled) {
      lastSpokenRef.current = index
      speakText(last.content)
    }
  }, [messages, speakText, voiceEnabled])

  const endInterview = useCallback(async (automatic = false) => {
    if (endingRef.current || ended) return
    endingRef.current = true
    setError('')
    stopListening()
    stopMonitoring()
    window.speechSynthesis?.cancel?.()

    try {
      const data = await apiRequest(`/api/sessions/end/${encodeURIComponent(session.sessionId)}`, {
        method: 'POST',
        body: JSON.stringify({ accessToken: session.accessToken })
      })
      sessionStorage.removeItem('interviewSession')
      setResult(data.summary || null)
      setEnded(true)
      if (automatic) setError('The scheduled interview time ended, so the session was submitted automatically.')
    } catch (err) {
      setError(err.message)
      endingRef.current = false
    }
  }, [apiRequest, ended, session.accessToken, session.sessionId, stopListening, stopMonitoring])

  useEffect(() => {
    if (!session.endTime || ended) return undefined
    const end = new Date(session.endTime).getTime()
    if (Number.isNaN(end)) return undefined

    const update = () => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setSecondsRemaining(seconds)
      if (seconds === 0) endInterview(true)
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [endInterview, ended, session.endTime])

  useEffect(() => {
    if (ended) return undefined
    const check = async () => {
      try {
        const data = await apiRequest(`/api/sessions/status/${encodeURIComponent(session.sessionId)}`)
        const status = data.status?.status
        if (['cancelled', 'expired', 'completed'].includes(status)) {
          setError(status === 'cancelled' ? 'This interview was cancelled by the recruiter.' : `This interview is ${status}.`)
          setEnded(true)
          stopListening()
          stopMonitoring()
        }
      } catch (err) {
        if (!/not accessible yet/i.test(err.message)) setError(err.message)
      }
    }
    const timer = window.setInterval(check, 30000)
    return () => window.clearInterval(timer)
  }, [apiRequest, ended, session.sessionId, stopListening, stopMonitoring])

  useEffect(() => () => {
    stopListening()
    stopMonitoring()
    window.speechSynthesis?.cancel?.()
  }, [stopListening, stopMonitoring])

  const startMonitoring = async () => {
    setMonitorError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported by this browser')
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = media
      setStream(media)
    } catch (err) {
      setMonitorError(`${err.message}. You can continue the interview without monitoring if permitted by your recruiter.`)
    }
  }

  const startListening = () => {
    setError('')
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice input is not supported by this browser. Please type your answer instead.')
      return
    }
    window.speechSynthesis?.cancel?.()
    setSpeaking(false)
    stopListening()

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-IN'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onstart = () => setListening(true)
    recognition.onresult = event => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const value = event.results[i][0]?.transcript || ''
        if (event.results[i].isFinal) finalText += `${value} `
        else interimText += value
      }
      const value = (finalText || interimText).trim()
      if (value) setInput(value)
    }
    recognition.onerror = event => {
      if (event.error !== 'aborted') setError(`Voice input error: ${event.error || 'unknown error'}`)
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    try { recognition.start() } catch (err) { setError(`Could not start voice input: ${err.message}`) }
  }

  const loadCodingTasks = useCallback(async () => {
    const data = await apiRequest(`/api/sessions/coding-tasks/${encodeURIComponent(session.sessionId)}`)
    const tasks = Array.isArray(data.codingTasks) ? data.codingTasks : []
    setCodingTasks(tasks)
    return tasks
  }, [apiRequest, session.sessionId])

  const notifyCodingStart = useCallback(async () => {
    if (codingStartedRef.current) return
    codingStartedRef.current = true
    try {
      await apiRequest(`/api/sessions/message/${encodeURIComponent(session.sessionId)}`, {
        method: 'POST',
        body: JSON.stringify({
          accessToken: session.accessToken,
          message: 'Starting coding test phase',
          messageType: 'system'
        })
      })
    } catch (err) {
      codingStartedRef.current = false
      throw err
    }
  }, [apiRequest, session.accessToken, session.sessionId])

  const openCoding = useCallback(async () => {
    setCodeOpen(true)
    setError('')
    try {
      const tasks = await loadCodingTasks()
      await notifyCodingStart()
      if (editorOrigin && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'startCodingTest',
          interviewSessionId: session.sessionId,
          candidateId: session.candidateId,
          tasks
        }, editorOrigin)
      }
    } catch (err) {
      setError(err.message)
    }
  }, [editorOrigin, loadCodingTasks, notifyCodingStart, session.candidateId, session.sessionId])

  const sendAnswer = async event => {
    event?.preventDefault?.()
    const answer = input.trim()
    if (!answer || sending || ended) return
    if (answer.length > 12000) {
      setError('Please keep an interview answer under 12,000 characters.')
      return
    }

    setSending(true)
    setError('')
    stopListening()
    setMessages(previous => [...previous, {
      id: `candidate-${Date.now()}`,
      role: 'candidate',
      content: answer,
      timestamp: new Date().toISOString()
    }])
    setInput('')

    try {
      const data = await apiRequest(`/api/sessions/message/${encodeURIComponent(session.sessionId)}`, {
        method: 'POST',
        body: JSON.stringify({ accessToken: session.accessToken, message: answer, messageType: 'answer' })
      })
      const response = data.aiResponse || data.response || data.message
      appendInterviewer(response)
      const lower = String(response || '').toLowerCase()
      if (CODING_TRIGGERS.some(trigger => lower.includes(trigger))) openCoding()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const submitCode = useCallback(async ({ submittedCode, submittedLanguage, executionResult = '' }) => {
    const value = String(submittedCode || '').trim()
    const output = String(executionResult || '').trim()
    if (!value && !output) {
      setError('Add code or an execution result before submitting the coding exercise.')
      return
    }

    setCodeSubmitting(true)
    setError('')
    try {
      const data = await apiRequest(`/api/sessions/message/${encodeURIComponent(session.sessionId)}`, {
        method: 'POST',
        body: JSON.stringify({
          accessToken: session.accessToken,
          message: 'Coding exercise submitted',
          messageType: 'code_result',
          codeResult: {
            code: value.slice(0, 6000),
            language: String(submittedLanguage || 'text').slice(0, 40),
            result: output.slice(0, 1500)
          }
        })
      })
      appendInterviewer(data.aiResponse || data.response || data.message)
      codingStartedRef.current = false
      setCodeOpen(false)
      setCode('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCodeSubmitting(false)
    }
  }, [apiRequest, appendInterviewer, session.accessToken, session.sessionId])

  useEffect(() => {
    if (!editorOrigin) return undefined
    const handleMessage = event => {
      if (event.origin !== editorOrigin || event.source !== iframeRef.current?.contentWindow) return
      let payload = event.data
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload) } catch { return }
      }
      if (!payload || typeof payload !== 'object') return
      if (payload.type === 'editorReady' || payload.type === 'editorAck') {
        iframeRef.current?.contentWindow?.postMessage({
          type: 'startCodingTest',
          interviewSessionId: session.sessionId,
          candidateId: session.candidateId,
          tasks: codingTasks
        }, editorOrigin)
        return
      }
      const isSubmission = payload.type === 'codeSubmission' || payload.type === 'code-result' || payload.action === 'submit'
      if (!isSubmission) return
      const data = payload.payload && typeof payload.payload === 'object' ? payload.payload : payload
      submitCode({
        submittedCode: data.code,
        submittedLanguage: data.language,
        executionResult: data.result || data.output
      })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [codingTasks, editorOrigin, session.candidateId, session.sessionId, submitCode])

  const editorLoaded = () => {
    if (!editorOrigin || !codeOpen) return
    iframeRef.current?.contentWindow?.postMessage({
      type: 'startCodingTest',
      interviewSessionId: session.sessionId,
      candidateId: session.candidateId,
      tasks: codingTasks
    }, editorOrigin)
  }

  if (ended) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-5">
        <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <CheckCircle2 size={58} className="mx-auto text-emerald-400" />
          <h1 className="mt-5 text-2xl font-semibold">Interview submitted</h1>
          <p className="mt-2 text-sm text-slate-400">Your responses have been saved. You may close this tab.</p>
          {result && <div className="mt-6 rounded-xl bg-slate-950 p-4 text-left text-sm text-slate-300"><p>Candidate: {result.candidateName || session.candidateName}</p><p className="mt-1">Duration: {result.duration || '—'}</p><p className="mt-1">Questions: {result.questionsAsked ?? '—'}</p></div>}
          {error && <p className="mt-4 text-xs text-amber-300">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><Bot size={21} /></div>
            <div className="min-w-0"><p className="truncate font-semibold text-slate-950">{session.candidateName || 'Technical Interview'}</p><p className="truncate text-xs text-slate-500">{session.position || session.role || 'Interview'}{session.companyName ? ` · ${session.companyName}` : ''}</p></div>
          </div>
          <div className="flex items-center gap-2">
            {secondsRemaining !== null && <span className={`rounded-lg px-3 py-2 font-mono text-sm font-semibold ${secondsRemaining < 300 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{formatDuration(secondsRemaining)}</span>}
            <button onClick={() => endInterview(false)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">End interview</button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_360px]">
        <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center"><AIAvatar3D className="h-5 w-5" /></div><div><p className="font-semibold text-slate-900">AI Interviewer</p><p className="text-xs text-slate-500">Secure live assessment</p></div></div>
            <div className="flex gap-2">
              <button aria-label="Toggle interviewer voice" onClick={() => { setVoiceEnabled(value => !value); window.speechSynthesis?.cancel?.(); setSpeaking(false) }} className="rounded-lg border p-2 text-slate-600">{voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
              <button onClick={openCoding} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Code2 size={16} /> Coding</button>
            </div>
          </div>

          {error && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}

          <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-5">
            {loading && <p className="py-12 text-center text-sm text-slate-500">Preparing your interview…</p>}
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'candidate' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>{message.content}</div>
              </div>
            ))}
            {sending && <div className="text-xs text-slate-400">AI interviewer is preparing the next question…</div>}
            {speaking && <div className="text-xs text-blue-600">Interviewer is speaking…</div>}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendAnswer} className="border-t border-slate-200 p-4">
            <textarea value={input} onChange={event => setInput(event.target.value)} disabled={sending || loading} rows="3" maxLength={12000} placeholder="Type your answer here…" className="w-full resize-none rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <button type="button" onClick={listening ? stopListening : startListening} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${listening ? 'border-red-200 bg-red-50 text-red-700' : 'text-slate-700'}`}>{listening ? <MicOff size={17} /> : <Mic size={17} />}{listening ? 'Stop listening' : 'Voice answer'}</button>
              <button disabled={!input.trim() || sending || loading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"><Send size={17} /> Send answer</button>
            </div>
          </form>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><div><p className="font-semibold text-slate-900">Interview monitoring</p><p className="text-xs text-slate-500">Camera, face, object and audio signals</p></div>{stream ? <button onClick={stopMonitoring} className="rounded-lg border p-2 text-red-600" aria-label="Stop monitoring"><CameraOff size={18} /></button> : <button onClick={startMonitoring} className="rounded-lg border p-2 text-blue-600" aria-label="Start monitoring"><Camera size={18} /></button>}</div>
            {stream ? <VideoMonitor stream={stream} /> : <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl bg-slate-950 p-5 text-center text-white"><CameraOff size={34} className="text-slate-500" /><p className="mt-3 text-sm font-medium">Monitoring is off</p><button onClick={startMonitoring} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium">Enable camera & microphone</button></div>}
            {monitorError && <p className="mt-3 text-xs leading-5 text-amber-700">{monitorError}</p>}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <p className="font-semibold text-slate-900">Session</p>
            <div className="mt-3 space-y-2 text-slate-600"><p>Candidate: {session.candidateName || '—'}</p><p>Role: {session.position || session.role || '—'}</p><p>Status: Active</p><p>Voice: {voiceEnabled ? 'Enabled' : 'Muted'}</p></div>
          </div>
        </aside>
      </main>

      {codeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 sm:p-6">
          <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3"><div><p className="font-semibold text-slate-900">Coding exercise</p><p className="text-xs text-slate-500">Your interview credential is never shared with the embedded editor.</p></div><button onClick={() => setCodeOpen(false)} className="rounded-lg p-2 text-slate-600"><X size={20} /></button></div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[1.4fr_0.6fr]">
              <div className="min-h-[360px] border-b lg:border-b-0 lg:border-r">
                {editorOrigin ? <iframe ref={iframeRef} title="Coding editor" src={config.CODE_EDITOR_URL} onLoad={editorLoaded} className="h-full min-h-[420px] w-full" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="clipboard-read; clipboard-write" /> : <div className="flex h-full items-center justify-center p-8 text-sm text-slate-500">External editor URL is not configured correctly.</div>}
              </div>
              <div className="overflow-auto p-4 space-y-4">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Tasks</p>{codingTasks.length ? <div className="mt-2 space-y-3">{codingTasks.map((task, index) => <div key={task.id || index} className="rounded-xl border bg-slate-50 p-3"><p className="font-medium text-slate-900">{task.title || `Task ${index + 1}`}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{task.description || ''}</p></div>)}</div> : <p className="mt-2 text-sm text-slate-500">Loading coding tasks…</p>}</div>
                <div className="border-t pt-4"><p className="text-sm font-semibold text-slate-900">Built-in submission fallback</p><p className="mt-1 text-xs text-slate-500">If the embedded editor cannot submit, paste your solution here.</p><select value={language} onChange={event => setLanguage(event.target.value)} className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"><option value="javascript">JavaScript</option><option value="python">Python</option><option value="cpp">C++</option><option value="java">Java</option><option value="text">Other</option></select><textarea value={code} onChange={event => setCode(event.target.value)} rows="12" maxLength={6000} placeholder="Paste or write your solution…" className="mt-2 w-full rounded-lg border px-3 py-2 font-mono text-xs" /><button disabled={codeSubmitting || !code.trim()} onClick={() => submitCode({ submittedCode: code, submittedLanguage: language })} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{codeSubmitting ? <Square size={15} /> : <Code2 size={16} />}{codeSubmitting ? 'Submitting…' : 'Submit solution'}</button></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}