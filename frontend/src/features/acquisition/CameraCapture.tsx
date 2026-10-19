import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, Upload } from 'lucide-react'
import { Button, Notice } from '../../components/ui'
import { useT } from '../../lib/i18n'

type CamState = 'starting' | 'live' | 'captured' | 'denied' | 'unavailable' | 'insecure'

/**
 * Browser camera capture with permission handling and an upload fallback.
 * A phone or laptop camera alone is not a fundus camera (spec §6).
 */
export function CameraCapture({ onCapture, onFallback }: { onCapture: (blob: Blob) => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const t = useT()
  const [state, setState] = useState<CamState>('starting')
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null)
  const [detail, setDetail] = useState('')

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  const start = async () => {
    setState('starting')
    if (!window.isSecureContext) return setState('insecure')
    if (!navigator.mediaDevices?.getUserMedia) return setState('unavailable')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      stream.current = s
      if (video.current) {
        video.current.srcObject = s
        await video.current.play().catch(() => undefined)
      }
      setState('live')
    } catch (e) {
      const name = (e as DOMException).name
      setDetail((e as Error).message)
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
    }
  }

  useEffect(() => {
    start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const capture = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob(
      (b) => {
        if (!b) return
        setShot({ url: URL.createObjectURL(b), blob: b })
        setState('captured')
        stop()
      },
      'image/jpeg',
      0.92,
    )
  }

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
    start()
  }

  if (state === 'denied' || state === 'unavailable' || state === 'insecure') {
    return (
      <div className="space-y-4">
        <Notice tone="warn" title={state === 'denied' ? t('Camera permission denied') : state === 'insecure' ? t('Camera needs a secure connection') : t('No camera available')}>
          {state === 'denied'
            ? t('Allow camera access in your browser’s site settings, then try again — or upload an image from the fundus camera instead.')
            : state === 'insecure'
              ? t('Browsers only allow camera access over HTTPS or localhost. Upload the image instead.')
              : `${t('A camera could not be started.')}${detail ? ` (${detail})` : ''} ${t('Upload the image instead.')}`}
        </Notice>
        <div className="flex gap-2">
          {state === 'denied' && (
            <Button onClick={start}>
              <RefreshCw size={14} /> {t('Try again')}
            </Button>
          )}
          <Button variant="primary" onClick={onFallback}>
            <Upload size={14} /> {t('Upload instead')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Notice tone="info">{t('A phone or laptop camera is not a fundus camera. Use this only with a suitable fundus acquisition device or adapter.')}</Notice>
      <div className="relative aspect-video overflow-hidden rounded-xl border border-line bg-black">
        {state === 'captured' && shot ? (
          <img src={shot.url} alt={t('Captured frame')} className="h-full w-full object-contain" />
        ) : (
          <video ref={video} playsInline muted className="h-full w-full object-contain" />
        )}
        {state === 'starting' && <div className="absolute inset-0 flex items-center justify-center text-sm text-haze">{t('Starting camera…')}</div>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {state === 'captured' ? (
          <>
            <Button onClick={retake}>
              <RefreshCw size={14} /> {t('Retake')}
            </Button>
            <Button variant="primary" onClick={() => shot && onCapture(shot.blob)}>
              {t('Use this image')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={capture} disabled={state !== 'live'}>
            <Camera size={14} /> {t('Capture')}
          </Button>
        )}
      </div>
    </div>
  )
}
