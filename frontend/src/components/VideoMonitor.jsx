import * as cocoSsd from '@tensorflow-models/coco-ssd'
import '@tensorflow/tfjs'
import { useEffect, useRef, useState } from 'react'

const FACE_INTERVAL_MS = 250
const OBJECT_INTERVAL_MS = 1200
const LOUDNESS_THRESHOLD = 38
const SUSPICIOUS_OBJECTS = new Set(['cell phone', 'book', 'remote'])

const VideoMonitor = ({ stream }) => {
  const videoRef = useRef(null)
  const faceDetectorRef = useRef(null)
  const objectDetectorRef = useRef(null)
  const faceBusyRef = useRef(false)
  const objectBusyRef = useRef(false)
  const audioContextRef = useRef(null)
  const loudRef = useRef(false)

  const [modelsReady, setModelsReady] = useState(false)
  const [modelError, setModelError] = useState('')
  const [faceCount, setFaceCount] = useState(0)
  const [detectedObjects, setDetectedObjects] = useState([])
  const [isLoud, setIsLoud] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      try {
        const [{ FaceDetection }, objectDetector] = await Promise.all([
          import('@mediapipe/face_detection'),
          cocoSsd.load()
        ])
        if (cancelled) return

        const faceDetector = new FaceDetection({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/${file}`
        })
        faceDetector.setOptions({ model: 'short', minDetectionConfidence: 0.55 })
        faceDetector.onResults((results) => {
          if (cancelled) return
          setFaceCount(results?.detections?.length || 0)
        })

        faceDetectorRef.current = faceDetector
        objectDetectorRef.current = objectDetector
        setModelsReady(true)
      } catch (error) {
        console.error('Interview monitoring model load failed:', error)
        if (!cancelled) setModelError('Monitoring models could not be loaded. The interview can continue.')
      }
    }

    loadModels()

    return () => {
      cancelled = true
      try { faceDetectorRef.current?.close?.() } catch { /* no-op */ }
      faceDetectorRef.current = null
      objectDetectorRef.current = null
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!stream) {
      video.srcObject = null
      setFaceCount(0)
      setDetectedObjects([])
      return
    }

    video.srcObject = stream
    video.play().catch(() => {})
  }, [stream])

  useEffect(() => {
    if (!stream || !modelsReady) return
    const video = videoRef.current
    if (!video) return

    let stopped = false

    const runFaceDetection = async () => {
      if (stopped || faceBusyRef.current || !faceDetectorRef.current || video.readyState < 2) return
      faceBusyRef.current = true
      try {
        await faceDetectorRef.current.send({ image: video })
      } catch (error) {
        console.debug('Face detection frame skipped:', error?.message)
      } finally {
        faceBusyRef.current = false
      }
    }

    const runObjectDetection = async () => {
      if (stopped || objectBusyRef.current || !objectDetectorRef.current || video.readyState < 2) return
      objectBusyRef.current = true
      try {
        const predictions = await objectDetectorRef.current.detect(video)
        if (!stopped) {
          setDetectedObjects(
            predictions
              .filter((item) => item.class !== 'person' && item.score >= 0.55)
              .map((item) => ({ class: item.class, score: item.score }))
              .slice(0, 5)
          )
        }
      } catch (error) {
        console.debug('Object detection frame skipped:', error?.message)
      } finally {
        objectBusyRef.current = false
      }
    }

    runFaceDetection()
    runObjectDetection()
    const faceTimer = window.setInterval(runFaceDetection, FACE_INTERVAL_MS)
    const objectTimer = window.setInterval(runObjectDetection, OBJECT_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(faceTimer)
      window.clearInterval(objectTimer)
      faceBusyRef.current = false
      objectBusyRef.current = false
    }
  }, [stream, modelsReady])

  useEffect(() => {
    if (!stream || !stream.getAudioTracks().some((track) => track.readyState === 'live')) {
      setIsLoud(false)
      loudRef.current = false
      return
    }

    let frameId = null
    let audioContext = null
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return

      audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.75
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      const values = new Uint8Array(analyser.frequencyBinCount)
      let consecutiveLoudFrames = 0

      const measure = () => {
        analyser.getByteFrequencyData(values)
        let total = 0
        for (let i = 0; i < values.length; i += 1) total += values[i]
        const average = total / values.length

        if (average > LOUDNESS_THRESHOLD) consecutiveLoudFrames += 1
        else consecutiveLoudFrames = Math.max(0, consecutiveLoudFrames - 2)

        const nextLoud = consecutiveLoudFrames >= 8
        if (nextLoud !== loudRef.current) {
          loudRef.current = nextLoud
          setIsLoud(nextLoud)
        }
        frameId = requestAnimationFrame(measure)
      }

      measure()
    } catch (error) {
      console.warn('Audio monitoring unavailable:', error)
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId)
      if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
      audioContextRef.current = null
      loudRef.current = false
    }
  }, [stream])

  const suspiciousObjects = detectedObjects.filter((item) => SUSPICIOUS_OBJECTS.has(item.class))
  const faceViolation = Boolean(stream) && modelsReady && faceCount !== 1
  const objectViolation = suspiciousObjects.length > 0
  const hasViolation = faceViolation || objectViolation

  let status = 'Monitoring ready'
  if (!stream) status = 'Camera is off'
  else if (!modelsReady && !modelError) status = 'Loading monitoring models…'
  else if (faceCount === 0) status = 'No face detected'
  else if (faceCount > 1) status = 'Multiple faces detected'
  else if (objectViolation) status = `Potential restricted object: ${suspiciousObjects.map((item) => item.class).join(', ')}`
  else status = 'Single face detected'

  return (
    <div className="relative w-full h-full min-h-[220px] bg-black overflow-hidden rounded-xl">
      <video ref={videoRef} muted playsInline className="w-full h-full object-cover scale-x-[-1]" />

      <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none">
        <div className={`px-3 py-2 rounded-lg text-xs font-semibold shadow ${hasViolation ? 'bg-red-600 text-white' : 'bg-black/70 text-white'}`}>
          {status}
        </div>
        <div className="bg-black/70 text-white rounded-lg px-3 py-2 text-xs space-y-1 shadow">
          <div>Faces: {faceCount}</div>
          <div>Objects: {detectedObjects.length}</div>
          <div>Audio: {isLoud ? 'Loud' : 'Normal'}</div>
        </div>
      </div>

      {detectedObjects.length > 0 && (
        <div className="absolute bottom-3 left-3 right-3 bg-black/70 text-white rounded-lg px-3 py-2 text-xs">
          Detected: {detectedObjects.map((item) => `${item.class} ${Math.round(item.score * 100)}%`).join(' · ')}
        </div>
      )}

      {modelError && (
        <div className="absolute inset-x-3 bottom-3 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg px-3 py-2 text-xs">
          {modelError}
        </div>
      )}
    </div>
  )
}

export default VideoMonitor
