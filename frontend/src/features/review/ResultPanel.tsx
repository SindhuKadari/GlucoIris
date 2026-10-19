import { AlertTriangle, Info } from 'lucide-react'
import type { Classification, Encounter, EvidenceArtifact, EyeImage, Grade, Laterality, ModuleKey, ModuleState, QualityResult } from '../../types/domain'
import { MODULE_KEYS } from '../../types/domain'
import { fixtureById, referenceGradeLabel } from '../../demo/fixtures'
import { Badge, GradeChip, ModuleStatusBadge, Notice, QualityBadge, SimulatedTag } from '../../components/ui'
import { EYE_LABEL, formatDate, GRADE_HEX, GRADE_LABEL, MODULE_LABEL, pct } from '../../lib/util'
import { useT } from '../../lib/i18n'

export function ResultPanel({
  eye,
  encounter,
  image,
  quality,
  classification,
  modules,
  b4,
  wide,
}: {
  eye: Laterality
  b4?: EvidenceArtifact['result']
  encounter: Encounter
  image?: EyeImage
  quality?: QualityResult
  classification?: Classification
  modules?: Record<ModuleKey, ModuleState>
  /** Two columns (DR detection + status | ViT grade) to avoid vertical scrolling on wide screens. */
  wide?: boolean
}) {
  const notScreened = encounter.notScreened[eye]
  const t = useT()
  const fx = image?.source.kind === 'fixture' ? fixtureById(image.source.fixtureId) : undefined

  const grade =
    notScreened || !image ? (
      <Notice tone="info" title={t('Not screened')}>
        {t(notScreened ?? 'No retinal fundus image was acquired.')}
      </Notice>
    ) : quality?.outcome === 'ungradeable' ? (
      <Notice tone="bad" title={t('Unable to screen: image quality inadequate')}>
        {t(quality.reasons[0] ?? '')} {t('No classification was run for this image.')}
      </Notice>
    ) : !classification ? (
      b4 ? null : (
        <Notice tone="warn" title={t('No model result')}>
          {t(modules?.classification?.message ?? 'Classification has not produced a result for this image.')}
        </Notice>
      )
    ) : (
      <ClassificationBlock c={classification} />
    )

  const detection = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{t(EYE_LABEL[eye])}</div>
        {image && <QualityBadge outcome={quality?.outcome} overridden={!!quality?.override} />}
      </div>

      {b4 && quality?.outcome !== 'ungradeable' && <B4Block r={b4} />}

      {quality?.override && (
        <p className="text-xs text-haze">
          <AlertTriangle size={12} className="mr-1 inline text-warn" />
          {t('Borderline image accepted by {name}: {reason}', { name: quality.override.by, reason: quality.override.reason })}
        </p>
      )}

      {image && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink">{t('Module status')}</div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {MODULE_KEYS.map((k) => (
              <li key={k} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-xs text-haze">{t(MODULE_LABEL[k])}</span>
                {modules?.[k] ? <ModuleStatusBadge status={modules[k].status} /> : <Badge>{t('Not run')}</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fx && (
        <details className="rounded-xl border border-line bg-panel-2/40 px-3.5 py-2.5 text-xs">
          <summary className="cursor-pointer text-haze">{t('Demo fixture details')}</summary>
          <dl className="mt-2 space-y-1 text-haze">
            <div>{t('Source')}: {fx.dataset} · {fx.source}</div>
            <div>{referenceGradeLabel(fx)} — {t('shown for demo comparison only; not a model input.')}</div>
            <div>{t('Laterality')} {fx.lateralitySource}.</div>
            {fx.note && <div>{fx.note}</div>}
          </dl>
        </details>
      )}
    </>
  )

  if (wide) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">{detection}</div>
        <div className="min-w-0 space-y-4">{grade}</div>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {detection}
      {grade}
    </div>
  )
}

function B4Block({ r }: { r: NonNullable<EvidenceArtifact['result']> }) {
  const t = useT()
  return (
    <div className="rounded-xl border border-line bg-panel-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-haze">{t('DR detection')} · EfficientNet-B4</div>
        <Badge tone="info">{t('Model output')}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Badge tone={r.positive ? 'warn' : 'ok'}>{t(r.label)}</Badge>
        <span className="font-mono text-lg tabular-nums text-ink">P(DR) {r.probability.toFixed(3)}</span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-panel-3" aria-hidden>
        <div className={r.positive ? 'h-full bg-warn' : 'h-full bg-ok'} style={{ width: pct(r.probability) }} />
        <div className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: pct(r.threshold) }} />
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-haze">
        {t('No DR (grade 0) vs DR (grades 1–4). Threshold {threshold} (as trained). The Grad-CAM heatmap is shown in Review.', { threshold: r.threshold.toFixed(2) })} {r.version}
      </p>
    </div>
  )
}

function ClassificationBlock({ c }: { c: Classification }) {
  const gradeDisagrees = (c.predictedGrade >= 2) !== c.referableFlag
  const t = useT()
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-panel-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-haze">{t('Five-class DR grade')} · ViT</div>
          {c.provenance === 'simulated' && <SimulatedTag />}
        </div>
        {c.determinable ? (
          <div className="mt-2">
            <GradeChip grade={c.predictedGrade} />
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            <Badge tone="warn">
              <AlertTriangle size={11} /> {t('Unable to determine — review required')}
            </Badge>
            <p className="text-[12.5px] text-haze">{t('Top-class score below the determinability limit. Most likely: {grade}.', { grade: t(GRADE_LABEL[c.predictedGrade]) })}</p>
          </div>
        )}
        <div className="mt-4 space-y-1.5" aria-label={t('Class scores')}>
          {c.probabilities.map((p, g) => (
            <div key={g} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-8 font-mono text-haze">G{g}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-3">
                <div className="h-full rounded-full" style={{ width: pct(p), background: GRADE_HEX[g as Grade], opacity: g === c.predictedGrade ? 1 : 0.55 }} />
              </div>
              <span className="w-10 text-right font-mono tabular-nums text-ink/85">{pct(p, 1)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
        <div>
          <div className="text-[12.5px] text-haze">{t('Referable-DR score')}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg tabular-nums">{c.referableDrScore.toFixed(2)}</span>
            <span className="text-[12px] text-haze/80">p2+p3+p4 · {t('threshold')} {c.referableThreshold.toFixed(2)}</span>
          </div>
        </div>
        {c.referableFlag ? <Badge tone="warn">{t('Referable — flagged')}</Badge> : <Badge tone="ok">{t('Below threshold')}</Badge>}
      </div>
      {gradeDisagrees && (
        <Notice tone="warn" title={t('Grade and referral flag disagree')}>
          {t('The most likely grade ({grade}) and the thresholded referable score point different ways. Both are shown unchanged; the clinician decides.', { grade: t(GRADE_LABEL[c.predictedGrade]) })}
        </Notice>
      )}
      <div className="flex gap-2 text-[12.5px] leading-relaxed text-haze">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          {t(c.calibration === 'calibrated' ? 'Scores are calibrated model outputs, not risk estimates.' : 'Scores are uncalibrated model outputs, not calibrated risk estimates.')} {c.modelId} · {c.modelVersion} · preprocessing {c.preprocessingVersion} · {c.thresholdVersion} · {formatDate(c.createdAt, true)}
        </span>
      </div>
    </div>
  )
}
