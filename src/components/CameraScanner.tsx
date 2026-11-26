import { useEffect, useRef, useState } from 'react'
import { Flashlight, X, Camera, SwitchCamera } from 'lucide-react'

/** What the page tells the scanner after each code, so the overlay can show it. */
export interface ScanFeedback {
  ok: boolean
  text: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called for every new code. Return feedback to show on screen (optional). */
  onDetect: (code: string) => ScanFeedback | void
  /** Keep scanning after each code (sale / purchase) or close after the first (search, item code). */
  continuous?: boolean
  title?: string
}

// Formats found on shop products, plus QR.
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code']
// The same code counts again only after it has been out of view this long.
const SAME_CODE_GAP_MS = 1200

interface NativeDetector {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>
}
type DetectorCtor = {
  new (opts: { formats: string[] }): NativeDetector
  getSupportedFormats: () => Promise<string[]>
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (!window.isSecureContext) return 'The camera only works on an https:// address (or localhost).'
  if (name === 'NotAllowedError') return 'Camera permission was blocked. Allow the camera for this site in your browser settings, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device.'
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.'
  return 'Could not start the camera.'
}

/** Full-screen camera barcode scanner for phones and laptops. */
export default function CameraScanner({ open, onClose, onDetect, continuous = true, title = 'Scan barcode' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [count, setCount] = useState(0)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const trackRef = useRef<MediaStreamTrack | null>(null)

  // latest callbacks without restarting the camera
  const detectRef = useRef(onDetect)
  const closeRef = useRef(onClose)
  useEffect(() => {
    detectRef.current = onDetect
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    let stopped = false
    let stream: MediaStream | null = null
    let timer: number | undefined
    let zxingControls: { stop: () => void } | null = null
    let last = { code: '', seen: 0 }
    const videoEl = videoRef.current

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setStarting(true)
    setFeedback(null)
    setCount(0)
    setTorchOn(false)
    setTorchAvailable(false)

    const handle = (raw: string) => {
      const code = raw.trim()
      if (!code || stopped) return
      const now = Date.now()
      // still looking at the same barcode → don't add it again
      if (code === last.code && now - last.seen < SAME_CODE_GAP_MS) {
        last.seen = now
        return
      }
      last = { code, seen: now }
      navigator.vibrate?.(60)
      const fb = detectRef.current(code)
      setCount((c) => c + 1)
      setFeedback(fb ?? { ok: true, text: code })
      if (!continuous) closeRef.current()
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = stream
        video.setAttribute('playsinline', 'true')
        await video.play()

        const track = stream.getVideoTracks()[0]
        trackRef.current = track
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] }
        setTorchAvailable(!!caps.torch)
        if (caps.focusMode?.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
        }
        setStarting(false)

        // 1) Built-in detector (Android Chrome, some desktops) — fastest.
        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
        const supported = Native ? await Native.getSupportedFormats().catch(() => [] as string[]) : []
        const formats = NATIVE_FORMATS.filter((f) => supported.includes(f))
        if (Native && formats.includes('ean_13')) {
          const detector = new Native({ formats })
          const tick = async () => {
            if (stopped) return
            try {
              if (video.readyState >= 2) {
                const found = await detector.detect(video)
                if (found[0]) handle(found[0].rawValue)
              }
            } catch {
              /* frame not ready */
            }
            timer = window.setTimeout(tick, 120)
          }
          tick()
          return
        }

        // 2) ZXing in JavaScript (iPhone Safari, Firefox …) — loaded only when needed.
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        if (stopped) return
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
          BarcodeFormat.QR_CODE,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 })
        zxingControls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) handle(result.getText())
        })
        if (stopped) zxingControls.stop()
      } catch (e) {
        if (!stopped) {
          setError(cameraError(e))
          setStarting(false)
        }
      }
    })()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      zxingControls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
      trackRef.current = null
      if (videoEl) videoEl.srcObject = null
    }
  }, [open, continuous, facing])

  // Esc closes
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  const toggleTorch = async () => {
    const t = trackRef.current
    if (!t) return
    try {
      await t.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(!torchOn)
    } catch {
      setTorchAvailable(false)
    }
  }

  if (!open) return null

  return (
    <div data-modal-open className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-medium">{title}</span>
        <div className="flex items-center gap-1">
          {torchAvailable && (
            <button onClick={toggleTorch} className={`rounded-full p-2 ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/10'}`} aria-label="Torch">
              <Flashlight className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            className="rounded-full bg-white/10 p-2"
            aria-label="Switch camera"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
          <button onClick={onClose} className="rounded-full bg-white/10 p-2" aria-label="Close camera">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`} />
        {/* aiming frame */}
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-40 w-[80%] max-w-md rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              <div className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-red-500" />
            </div>
          </div>
        )}
        {starting && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
            <Camera className="h-8 w-8 animate-pulse" /> Starting camera…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-xl bg-white p-5 text-center text-sm text-slate-800">
              <p className="mb-4">{error}</p>
              <button onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white">
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {feedback ? (
          <div className={`rounded-lg px-3 py-2 text-sm font-medium ${feedback.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>{feedback.text}</div>
        ) : (
          <div className="text-center text-sm text-white/70">Hold the barcode inside the box</div>
        )}
        {continuous && count > 0 && (
          <div className="text-center text-xs text-white/60">Same item again? Move the camera away, then back.</div>
        )}
        {continuous && (
          <button onClick={onClose} className="w-full rounded-lg bg-white py-3 font-semibold text-slate-900">
            Done{count ? ` · ${count} scanned` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
