import { useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { AlertTriangle, ArrowRight, Camera, FileImage, ImagePlus, Library, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { EyeImage, Fixture, Laterality } from '../types/domain'
import { activeImages, useStore } from '../store/store'
import { FIXTURES, DATASET_ATTRIBUTION, referenceGradeLabel } from '../demo/fixtures'
import { intakeFile, intakeFixture, IntakeError, ACCEPTED_TYPES } from '../services/imageIntake'
import { CameraCapture } from '../features/acquisition/CameraCapture'
import { EncounterNotFound, EyeImg, ScreeningFrame, ScreeningHeader, StepBar, useEncounterContext } from '../features/screening/common'
import { Badge, Button, Card, CardHeader, Dialog, Notice, ProgressBar } from '../components/ui'
import { cx, formatBytes, formatDate, IMAGE_SLOT } from '../lib/util'
import { useT } from '../lib/i18n'

type Busy = { stage: string; progress: number } | null

function EyePanel({ encounterId, eye, image, device }: { encounterId: string; eye: Laterality; image?: EyeImage; device?: string }) {
  const addImage = useStore((s) => s.addImage)
  const removeImage = useStore((s) => s.removeImage)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<{ msg: string; retry?: () => void } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [camera, setCamera] = useState(false)
  const [library, setLibrary] = useState(false)
  const t = useT()

  const ingest = async (fn: () => Promise<Omit<EyeImage, 'id' | 'status'>>) => {
    setError(null)
    setBusy({ stage: t('Validating file'), progress: 0.25 })
    try {
      const rec = await fn()
      setBusy({ stage: t('Storing image'), progress: 0.8 })
      addImage(rec)
      setBusy({ stage: t('Done'), progress: 1 })
      setTimeout(() => setBusy(null), 250)
    } catch (e) {
      setBusy(null)
      setError({ msg: e instanceof IntakeError ? e.message : t('Image could not be saved: {error}', { error: (e as Error).message }), retry: e instanceof IntakeError ? undefined : () => ingest(fn) })
    }
  }

  const onFiles = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    ingest(() => intakeFile(f, encounterId, eye, 'upload', device))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    onFiles(e.dataTransfer.files)
  }

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader
        title={t('Retinal fundus image')}
        subtitle={image ? `${image.origin === 'fixture' ? t('Sample image') : image.origin === 'camera' ? t('Camera capture') : t('Upload')} · ${formatDate(image.acquiredAt, true)}` : t('No image yet')}
        action={image ? <Badge tone="ok">{t('Image attached')}</Badge> : <Badge tone="warn">{t('Required')}</Badge>}
      />
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {image ? (
          <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
            <EyeImg image={image} className="h-full min-h-[260px] w-full rounded-xl border border-line" />
            <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-haze">{t('File')}</dt>
              <dd className="truncate text-right text-ink" title={image.fileName}>{image.fileName}</dd>
              <dt className="text-haze">{t('Dimensions')}</dt>
              <dd className="text-right font-mono text-ink">{image.width}×{image.height}</dd>
              <dt className="text-haze">{t('Size')}</dt>
              <dd className="text-right font-mono text-ink">{formatBytes(image.bytes)}</dd>
              <dt className="text-haze">SHA-256</dt>
              <dd className="text-right font-mono text-ink" title={image.checksum}>{image.checksum.slice(0, 12)}…</dd>
            </dl>
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <Button onClick={() => fileInput.current?.click()}>
                <RefreshCw size={15} /> {t('Replace with a file')}
              </Button>
              <Button onClick={() => setLibrary(true)}>
                <Library size={15} /> {t('Replace with sample')}
              </Button>
              <Button variant="danger" onClick={() => removeImage(image.id)}>
                <Trash2 size={15} /> {t('Remove image')}
              </Button>
            </div>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cx(
              'flex min-h-[280px] flex-1 flex-col items-center justify-center gap-5 rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors',
              dragOver ? 'border-electric bg-electric/10' : 'border-line-strong bg-panel-2',
            )}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-electric/10 text-electric" aria-hidden>
              <ImagePlus size={28} />
            </span>
            <div className="space-y-1">
              <div className="text-lg font-semibold text-ink">{t('Drop a fundus image here')}</div>
              <div className="text-sm text-haze">{t('or choose one of the options below · JPEG or PNG, up to 20 MB')}</div>
            </div>
            <div className="flex w-full max-w-lg flex-col gap-2 sm:flex-row sm:justify-center">
              <Button variant="primary" size="lg" onClick={() => fileInput.current?.click()} className="w-full sm:w-auto">
                <Upload size={17} aria-hidden /> {t('Browse files')}
              </Button>
              <Button size="lg" onClick={() => setCamera(true)} className="w-full sm:w-auto">
                <Camera size={17} aria-hidden /> {t('Camera')}
              </Button>
              <Button size="lg" onClick={() => setLibrary(true)} className="w-full sm:w-auto">
                <Library size={17} aria-hidden /> {t('Sample image')}
              </Button>
            </div>
          </div>
        )}

        {busy && (
          <div className="mt-3 space-y-1.5" aria-live="polite">
            <div className="text-xs text-haze">{busy.stage}…</div>
            <ProgressBar value={busy.progress} />
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Notice tone="bad" title={t('Image not accepted')}>
              {error.msg}
              {error.retry && (
                <Button size="sm" className="mt-2" onClick={error.retry}>
                  <RefreshCw size={13} /> {t('Retry')}
                </Button>
              )}
            </Notice>
          </div>
        )}
        <input ref={fileInput} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} aria-label={t('Upload retinal fundus image')} />
      </div>

      <Dialog open={camera} onClose={() => setCamera(false)} title={t('Capture — Retinal fundus image')}>
        {camera && (
          <CameraCapture
            onCapture={(blob) => {
              setCamera(false)
              ingest(() => intakeFile(Object.assign(blob, { name: `camera-fundus-${Date.now()}.jpg` }), encounterId, eye, 'camera', device))
            }}
            onFallback={() => {
              setCamera(false)
              fileInput.current?.click()
            }}
          />
        )}
      </Dialog>

      <SampleLibrary
        open={library}
        onClose={() => setLibrary(false)}
        onPick={(fx) => {
          setLibrary(false)
          ingest(() => intakeFixture(fx, encounterId, eye))
        }}
      />
    </Card>
  )
}

function SampleLibrary({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (f: Fixture) => void }) {
  const t = useT()
  return (
    <Dialog open={open} onClose={onClose} title={t('Demo sample images')}>
      <p className="mb-3 text-xs leading-relaxed text-haze">
        {t('Public research retinal fundus images bundled for demonstration. Results for these images are simulated.')}
      </p>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {FIXTURES.map((f) => (
          <li key={f.id}>
            <button onClick={() => onPick(f)} className="group w-full overflow-hidden rounded-lg border border-line text-left transition-colors hover:border-cyan/50">
              <img src={f.thumb} alt="" className="aspect-[4/3] w-full bg-black object-cover" loading="lazy" />
              <div className="space-y-0.5 p-2">
                <div className="truncate text-[12.5px] font-medium text-ink">{f.source}</div>
                <div className="truncate text-[12px] text-haze">{f.scenario !== 'standard' ? t('Degraded: {kind}', { kind: t(f.scenario) }) : referenceGradeLabel(f)}</div>
                <div className="text-[12px] text-haze/80">{f.dataset}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-1 border-t border-line pt-3 text-[12px] leading-relaxed text-haze/80">
        {Object.values(DATASET_ATTRIBUTION).map((a) => (
          <p key={a}>{a}</p>
        ))}
      </div>
    </Dialog>
  )
}

export default function AcquisitionPage() {
  const { encounter, patient } = useEncounterContext()
  const images = useStore(useShallow((s) => (encounter ? activeImages(s, encounter.id) : [])))
  const setStatus = useStore((s) => s.setEncounterStatus)
  const navigate = useNavigate()
  const t = useT()
  if (!encounter || !patient) return <EncounterNotFound />

  const image = images.find((i) => i.laterality === IMAGE_SLOT) ?? images[0]
  const ready = !!image
  const hasReport = useStore.getState().reports.some((r) => r.encounterId === encounter.id)

  const proceed = () => {
    setStatus(encounter.id, 'quality')
    navigate(`/screenings/${encounter.id}/quality`)
  }

  return (
    <ScreeningFrame
      header={<ScreeningHeader encounter={encounter} patient={patient} current="acquisition" />}
      bar={
        <StepBar
          back={{ to: '/dashboard', label: t('Dashboard') }}
          status={
            <span className="flex items-center gap-2">
              {ready ? <FileImage size={16} className="shrink-0 text-ok" /> : <AlertTriangle size={16} className="shrink-0 text-warn" />}
              {ready ? t('Retinal fundus image attached. Continue to the quality check.') : t('Attach a retinal fundus image to continue.')}
            </span>
          }
        >
          <Button variant="primary" size="lg" disabled={!ready} onClick={proceed}>
            <span className="md:hidden">{t('Continue')}</span><span className="hidden md:inline">{t('Continue to quality check')}</span> <ArrowRight size={18} />
          </Button>
        </StepBar>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        {hasReport && (
          <Notice tone="info" className="shrink-0" title={t('This screening already has a finalised report')}>
            {t('Changing an image creates a new image record and returns the screening to quality checking. The finalised report is preserved; re-finalising creates a traceable revision.')}
          </Notice>
        )}
        <div className="min-h-0 flex-1">
          <EyePanel encounterId={encounter.id} eye={image?.laterality ?? IMAGE_SLOT} image={image} device={encounter.device} />
        </div>
      </div>
    </ScreeningFrame>
  )
}
