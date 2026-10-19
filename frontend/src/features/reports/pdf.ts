import { jsPDF } from 'jspdf'
import type { EvidenceArtifact, Report, ReportSnapshot } from '../../types/domain'
import { resolveSourceUrl, loadImageElement } from '../../lib/images'
import { overlayUrl } from '../../lib/overlays'
import { ageFrom, EYE_LABEL, FOLLOW_UP_LABEL, formatDate, GRADE_LONG, MODULE_LABEL } from '../../lib/util'
import { getLang, translate, type Vars } from '../../lib/i18n'
import { CONSENT_LABEL, datasetCredits, DIABETES_LABEL, drVerdict, eyeSections, missingModules, QUALITY_LABEL, REPORT_LIMITATIONS, SEX_LABEL, type DrVerdict } from './reportModel'

const M = 16 // page margin (mm)
const W = 210
const H = 297
type RGB = [number, number, number]
const INK: RGB = [16, 22, 36]
const MUTED: RGB = [96, 108, 128]
const ACCENT: RGB = [41, 121, 255]

async function composite(base: string, overlay?: { url: string; opacity: number; screen?: boolean }, maxW = 1000): Promise<{ data: string; w: number; h: number }> {
  const img = await loadImageElement(base)
  const w = Math.min(maxW, img.width)
  const h = Math.round((img.height * w) / img.width)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  if (overlay) {
    const o = await loadImageElement(overlay.url)
    ctx.globalAlpha = overlay.opacity
    if (overlay.screen) ctx.globalCompositeOperation = 'screen'
    ctx.drawImage(o, 0, 0, w, h)
  }
  return { data: c.toDataURL('image/jpeg', 0.85), w, h }
}

/*
 * Text rendering. jsPDF's built-in fonts are Latin-only and it does no complex-script shaping,
 * so Telugu and Hindi conjuncts/vowel signs would break. For those languages every line is
 * drawn by the browser's text engine (which shapes Indic scripts correctly) onto a canvas and
 * placed as an image at the same position the jsPDF text would occupy. English keeps real,
 * selectable PDF text.
 */
const PX_PER_MM = 12 // ≈ 300 dpi
const PT_TO_MM = 0.3528
const FONT_STACK = '"Noto Sans Telugu", "Noto Sans Devanagari", "Helvetica Neue", Helvetica, Arial, sans-serif'

async function loadIndicFonts() {
  if (!document.fonts?.load) return
  await Promise.all(
    ['400', '700'].flatMap((w) => [document.fonts.load(`${w} 16px "Noto Sans Telugu"`, 'తెలుగు'), document.fonts.load(`${w} 16px "Noto Sans Devanagari"`, 'हिन्दी')]),
  ).catch(() => undefined)
}

export async function downloadReportPdf(snapshot: ReportSnapshot, meta: { status: 'draft' | 'final' | 'superseded'; report?: Report }) {
  const lang = getLang()
  const native = lang === 'en'
  const T = (s: string, v?: Vars) => translate(lang, s, v)
  if (!native) await loadIndicFonts()

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const demo = snapshot.encounter.mode === 'demo'
  let y = M

  const measure = document.createElement('canvas').getContext('2d')!
  const cssFont = (size: number, bold: boolean) => `${bold ? 700 : 400} ${size * PT_TO_MM * PX_PER_MM}px ${FONT_STACK}`
  /** Line advance in mm for a font size (Indic scripts need more room for vowel signs). */
  const step = (size: number) => (native ? size * 0.42 : size * 0.52)

  const split = (s: string, maxW: number, size: number, bold = false): string[] => {
    if (native) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      return doc.splitTextToSize(s, maxW) as string[]
    }
    measure.font = cssFont(size, bold)
    const maxPx = maxW * PX_PER_MM
    const out: string[] = []
    for (const para of s.split('\n')) {
      let line = ''
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word
        if (line && measure.measureText(next).width > maxPx) {
          out.push(line)
          line = word
        } else line = next
      }
      out.push(line)
    }
    return out
  }

  const lineImage = (s: string, size: number, bold: boolean, color: RGB) => {
    const fontPx = size * PT_TO_MM * PX_PER_MM
    measure.font = cssFont(size, bold)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.ceil(measure.measureText(s).width) + 4)
    c.height = Math.ceil(fontPx * 1.7)
    const ctx = c.getContext('2d')!
    ctx.font = cssFont(size, bold)
    ctx.fillStyle = `rgb(${color.join(',')})`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(s, 2, fontPx * 1.2)
    return { data: c.toDataURL('image/png'), w: c.width / PX_PER_MM, h: c.height / PX_PER_MM, ascent: (fontPx * 1.2) / PX_PER_MM, pad: 2 / PX_PER_MM }
  }

  /** Draw one or more lines with the first baseline at `by` (same contract as jsPDF `text`). */
  const draw = (lines: string | string[], x: number, by: number, size: number, opts: { bold?: boolean; color?: RGB; align?: 'left' | 'right' } = {}) => {
    const arr = Array.isArray(lines) ? lines : [lines]
    const color = opts.color ?? INK
    if (native) {
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.text(arr, x, by, opts.align === 'right' ? { align: 'right' } : undefined)
      return
    }
    arr.forEach((ln, i) => {
      if (!ln) return
      const im = lineImage(ln, size, !!opts.bold, color)
      const left = opts.align === 'right' ? x - im.w + im.pad : x - im.pad
      doc.addImage(im.data, 'PNG', left, by + i * step(size) - im.ascent, im.w, im.h)
    })
  }

  const ensure = (needed: number) => {
    if (y + needed > H - M - 8) {
      doc.addPage()
      y = M
    }
  }
  const text = (t: string, x: number, size = 9.5, opts: { bold?: boolean; color?: RGB; maxW?: number } = {}) => {
    const lines = split(t, opts.maxW ?? W - M - x, size, opts.bold)
    ensure(lines.length * step(size) + 1)
    draw(lines, x, y, size, opts)
    y += lines.length * step(size) + 1.2
  }
  const rule = () => {
    ensure(4)
    doc.setDrawColor(220, 226, 236)
    doc.line(M, y, W - M, y)
    y += 4
  }
  const heading = (t: string) => {
    ensure(12)
    y += 2
    text(t.toUpperCase(), M, 9, { bold: true, color: ACCENT })
    y += 0.5
  }
  const kv = (rows: [string, string][]) => {
    const lh = native ? 3.9 : 4.7
    for (const [k, v] of rows) {
      const lines = split(v || '—', W - M - 62, 9)
      ensure(lines.length * lh + 1)
      draw(split(k, 44, 9), M, y, 9, { color: MUTED })
      draw(lines, M + 46, y, 9)
      y += lines.length * lh + 1.2
    }
  }

  // Header
  doc.setFillColor(7, 11, 20)
  doc.rect(0, 0, W, 24, 'F')
  draw('GlucoIris', M, 11, 14, { bold: true, color: [245, 248, 255] })
  draw(T('Diabetic retinopathy screening report'), M, 17, 9, { color: [155, 170, 194] })
  const statusLabel =
    meta.status === 'draft'
      ? T('Draft — awaiting clinician review').toUpperCase()
      : meta.status === 'superseded'
        ? T('Superseded · revision {n}', { n: meta.report?.revision ?? '' }).toUpperCase()
        : T('Final · revision {n}', { n: meta.report?.revision ?? '' }).toUpperCase()
  draw(statusLabel, W - M, 11, 9, { color: [99, 217, 255], align: 'right' })
  if (demo) draw(T('Demonstration — not for clinical use').toUpperCase(), W - M, 17, 9, { color: [255, 181, 71], align: 'right' })
  y = 32

  const p = snapshot.patient
  const e = snapshot.encounter
  const notRecorded = T('Not recorded')
  heading(T('Patient and encounter'))
  kv([
    [T('Patient'), `${p.name} (${p.clinicPatientId})`],
    [T('Age / sex'), `${T('{age} years', { age: ageFrom(p.dateOfBirth, p.age) ?? '—' })} / ${p.sex ? T(SEX_LABEL[p.sex] ?? p.sex) : notRecorded}`],
    [T('Diabetes'), `${p.diabetesType ? T(DIABETES_LABEL[p.diabetesType] ?? p.diabetesType) : notRecorded}${p.diabetesSinceYear ? `, ${T('since {year}', { year: p.diabetesSinceYear })}` : ''}`],
    [T('HbA1c'), p.hba1c ? `${p.hba1c.value}% (${T('measured {date}', { date: formatDate(p.hba1c.measuredOn) })})` : notRecorded],
    [T('Screening date'), formatDate(e.createdAt, true)],
    [T('Operator'), e.operator],
    [T('Consent'), e.consent.obtained ? `${T('Obtained')} (${T(CONSENT_LABEL[e.consent.method] ?? e.consent.method)}), ${T('recorded {date}', { date: formatDate(e.consent.recordedAt) })}` : notRecorded],
    [T('Encounter ID'), e.id],
  ])

  // Headline DR answer: coloured box with large text (colour is always paired with words).
  const VERDICT_RGB: Record<DrVerdict['status'], { fill: RGB; edge: RGB; ink: RGB }> = {
    dr: { fill: [253, 236, 239], edge: [217, 45, 74], ink: [143, 16, 40] },
    no_dr: { fill: [233, 247, 238], edge: [21, 128, 61], ink: [15, 90, 43] },
    undetermined: { fill: [253, 243, 230], edge: [180, 83, 9], ink: [122, 58, 6] },
    not_screened: { fill: [238, 241, 246], edge: [154, 166, 184], ink: [59, 70, 88] },
  }
  const verdictBox = (v: DrVerdict) => {
    const c = VERDICT_RGB[v.status]
    const detail = split(v.detail, W - 2 * M - 12, 8.5)
    const h = 11 + detail.length * (native ? 3.7 : 4.5)
    ensure(h + 3)
    doc.setFillColor(...c.fill)
    doc.rect(M, y, W - 2 * M, h, 'F')
    doc.setFillColor(...c.edge)
    doc.rect(M, y, 2.2, h, 'F')
    draw(v.headline.toUpperCase(), M + 6, y + 7, 13, { bold: true, color: c.ink })
    draw(detail, M + 6, y + 12, 8.5, { color: c.ink })
    y += h + 3
  }

  for (const sec of eyeSections(snapshot)) {
    rule()
    heading(T(EYE_LABEL[sec.eye]))
    verdictBox(drVerdict(sec))
    if (!sec.image) {
      text(`${T('Not screened')}. ${sec.notScreenedReason ? T(sec.notScreenedReason) : ''}`, M, 9.5)
      continue
    }
    const q = sec.quality
    kv([
      [T('Image'), `${sec.image.fileName} · ${sec.image.width}×${sec.image.height}px · ${T('acquired {date}', { date: formatDate(sec.image.acquiredAt, true) })}`],
      [
        T('Image quality'),
        q
          ? `${T(QUALITY_LABEL[q.outcome])}${q.override ? ` (${T('borderline accepted by {name}: {reason}', { name: q.override.by, reason: q.override.reason })})` : ''}${q.reasons.length ? ` — ${q.reasons.map((r) => T(r)).join(' ')}` : ''}`
          : T('Not assessed'),
      ],
    ])
    if (q?.outcome === 'ungradeable') {
      text(T('Unable to screen: image quality inadequate. No classification was run.'), M, 9.5, { bold: true })
    } else if (sec.classification) {
      const c = sec.classification
      kv([
        [T('Model result'), `${c.determinable ? T(GRADE_LONG[c.predictedGrade]) : T('Unable to determine — review required (most likely {grade})', { grade: T(GRADE_LONG[c.predictedGrade]) })}  [${c.provenance === 'simulated' ? T('SIMULATED — demo fixture') : T('MODEL OUTPUT — research prototype')}]`],
        [T('Model'), `${c.modelId} · ${c.modelVersion}`],
        [T('Class scores'), c.probabilities.map((v, g) => `G${g} ${(v * 100).toFixed(1)}%`).join('  ')],
        [T('Referable-DR score'), `${c.referableDrScore.toFixed(2)} (p2+p3+p4); ${T('threshold')} ${c.referableThreshold.toFixed(2)} → ${c.referableFlag ? T('FLAGGED referable') : T('below threshold')}`],
        [T('Calibration'), T(c.calibration === 'calibrated' ? 'calibrated — model scores, not risk estimates' : 'uncalibrated — model scores, not risk estimates')],
      ])
    } else if (!sec.artifacts.some((a) => a.type === 'gradcam_b4' && a.result)) {
      text(`${T('No model result')}: ${T(sec.modules?.classification?.message ?? 'classification not run.')}`, M, 9.5)
    }
    const b4r = sec.artifacts.find((a) => a.type === 'gradcam_b4')?.result
    if (b4r && q?.outcome !== 'ungradeable') {
      // Without the five-class classifier the EfficientNet-B4 DR screen is the model result.
      kv([[sec.classification ? T('DR detection (EfficientNet-B4)') : T('Model result'), `${T(b4r.label)} · P(DR) ${b4r.probability.toFixed(3)} (${T('threshold')} ${b4r.threshold.toFixed(2)})  [${T('MODEL OUTPUT')} — ${b4r.model}, ${b4r.version}]`]])
      if (!sec.classification) kv([[T('Severity grade'), T('Five-class grading not connected — assigned by the clinician')]])
    }
    const ip = sec.interpretation
    kv([[T('Findings'), ip.findings || '—']])

    // Image evidence
    const base = await resolveSourceUrl(sec.image.source)
    if (base) {
      const views: { label: string; data: Promise<{ data: string; w: number; h: number }> }[] = [{ label: T('Original'), data: composite(base) }]
      const add = async (a: EvidenceArtifact | undefined, label: string, opacity: number, screen = false) => {
        if (!a) return
        views.push({ label, data: overlayUrl(a).then((u) => composite(base, { url: u, opacity, screen })) })
      }
      const prov = (a?: EvidenceArtifact) => ` (${T(a?.provenance === 'simulated' ? 'SIMULATED — illustrative only' : a?.provenance === 'reference_annotation' ? 'manual reference annotation' : 'model output')})`
      const mo = ` (${T('model output')})`
      const b4a = sec.artifacts.find((a) => a.type === 'gradcam_b4')
      if (b4a?.blendImageUrl) views.push({ label: `Grad-CAM — EfficientNet-B4 (${b4a.result ? T(b4a.result.label) : ''})${mo}`, data: composite(b4a.blendImageUrl) })
      else await add(b4a, `Grad-CAM — EfficientNet-B4${mo}`, 0.6)
      if (b4a?.boxesImageUrl) views.push({ label: `${T('Grad-CAM regions')} — EfficientNet-B4, ${T('{n} boxes', { n: b4a.camRegions?.length ?? 0 })}${mo}`, data: composite(b4a.boxesImageUrl) })
      const vita = sec.artifacts.find((a) => a.type === 'attribution' && a.provenance === 'model')
      if (vita?.blendImageUrl) views.push({ label: `Grad-CAM — ViT (${T('five-class grade')})${mo}`, data: composite(vita.blendImageUrl) })
      if (vita?.boxesImageUrl) views.push({ label: `${T('Grad-CAM regions')} — ViT, ${T('{n} boxes', { n: vita.camRegions?.length ?? 0 })}${mo}`, data: composite(vita.boxesImageUrl) })
      const ves = sec.artifacts.find((a) => a.type === 'vessel_mask')
      const les = sec.artifacts.find((a) => a.type === 'lesion_mask')
      await add(ves, `${T('Vessel mask')}${prov(ves)}`, 0.8)
      await add(les, `${T('Lesion segmentation')}${prov(les)}`, 0.85)
      if (les?.boxesImageUrl) views.push({ label: `${T('Lesion bounding boxes')} (${les.boxes?.length ?? 0})`, data: composite(les.boxesImageUrl) })

      const cols = 3 // fixed thumbnail width keeps rows compact
      const gap = 4
      const cw = (W - 2 * M - gap * (cols - 1)) / cols
      const resolved = await Promise.all(views.map((v) => v.data.catch(() => null)))
      for (let row = 0; row < resolved.length; row += cols) {
        const slice = resolved.slice(row, row + cols)
        const ch = Math.max(...slice.map((r) => (r ? (cw * r.h) / r.w : 0)))
        ensure(ch + 12)
        slice.forEach((r, i) => {
          if (!r) return
          const x = M + i * (cw + gap)
          doc.addImage(r.data, 'JPEG', x, y, cw, (cw * r.h) / r.w)
          draw(split(views[row + i].label, cw, 7.5), x, y + ch + 3.5, 7.5, { color: MUTED })
        })
        y += ch + (native ? 11 : 13)
      }
      if (les?.boxes?.length) {
        const counts = les.boxes.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.label]: (acc[b.label] ?? 0) + 1 }), {})
        kv([[T('Lesion regions'), Object.entries(counts).map(([k, v]) => `${T(k)}: ${v}`).join(' · ')]])
      } else if (les) {
        kv([[T('Lesion regions'), T('None above the model threshold')]])
      }
      if (ves && ves.provenance === 'model') kv([[T('Vessel analysis'), ves.method]])
    }
    const missing = missingModules(sec)
    if (missing.length) text(`${T('Evidence not available')}: ${missing.map((m) => T(MODULE_LABEL[m.module])).join('; ')}.`, M, 8, { color: MUTED })
  }

  rule()
  heading(T('Clinical plan and sign-off'))
  const r = snapshot.review
  kv([
    [T('Follow-up'), r.followUp ? T(FOLLOW_UP_LABEL[r.followUp]) : notRecorded],
    ...(r.notes ? ([[T('Notes'), r.notes]] as [string, string][]) : []),
    [T('Reviewer'), meta.status === 'draft' ? T('Not yet signed') : `${meta.report?.finalizedBy} · ${formatDate(meta.report?.finalizedAt, true)}`],
    ...(meta.report?.revisionReason ? ([[T('Revision reason'), meta.report.revisionReason]] as [string, string][]) : []),
  ])

  rule()
  heading(T('Provenance and limitations'))
  const c0 = snapshot.classifications[0]
  const b4First = snapshot.artifacts.find((a) => a.type === 'gradcam_b4' && a.result)?.result
  kv([
    [T('Data mode'), demo ? T('Demonstration (synthetic patient, simulated model outputs)') : T('Real')],
    [T('Classifier'), c0 ? `${c0.modelId} · ${c0.modelVersion} · ${c0.preprocessingVersion} · ${c0.thresholdVersion}` : b4First ? `${b4First.model} · ${b4First.version} (${T('binary DR detection, Grad-CAM on features[-1]')})` : T('No classifier output in this report')],
    [T('Quality screen'), snapshot.quality[0]?.version ?? '—'],
    [T('Report ID'), meta.report?.id ?? T('draft (unsaved)')],
  ])
  for (const l of REPORT_LIMITATIONS) text(`• ${T(l)}`, M, 8, { color: MUTED })
  for (const cr of datasetCredits(snapshot)) text(`${T('Image source')}: ${cr}`, M, 7.5, { color: MUTED })

  // Watermark + footer on every page
  const pages = doc.getNumberOfPages()
  const mark = demo ? T('DEMONSTRATION — NOT FOR CLINICAL USE') : T('DRAFT')
  const markImage = native ? null : watermarkImage(mark, cssFont(34, true))
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    if (demo || meta.status !== 'final') {
      if (markImage) {
        doc.addImage(markImage, 'PNG', 0, 0, W, H)
      } else {
        doc.saveGraphicsState()
        // @ts-expect-error GState is available at runtime on jsPDF instances
        doc.setGState(new doc.GState({ opacity: 0.08 }))
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(34)
        doc.setTextColor(41, 121, 255)
        doc.text(mark, W / 2, H / 2, { align: 'center', angle: 35 })
        doc.restoreGraphicsState()
      }
    }
    draw(`${p.clinicPatientId} · ${formatDate(e.createdAt)} · ${statusLabel}`, M, H - 8, 7.5, { color: MUTED })
    draw(T('Page {n} of {total}', { n: i, total: pages }), W - M, H - 8, 7.5, { color: MUTED, align: 'right' })
  }

  const fname = `GlucoIris_${p.clinicPatientId}_${e.createdAt.slice(0, 10)}_${meta.status === 'draft' ? 'DRAFT' : `rev${meta.report?.revision}`}${demo ? '_DEMO' : ''}${native ? '' : `_${lang}`}.pdf`
  doc.save(fname)
}

/** Full-page transparent PNG with the rotated watermark (for scripts jsPDF cannot shape). */
function watermarkImage(label: string, font: string): string {
  const c = document.createElement('canvas')
  c.width = W * PX_PER_MM * 0.5
  c.height = H * PX_PER_MM * 0.5
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((-35 * Math.PI) / 180)
  ctx.font = font.replace(/(\d+(\.\d+)?)px/, (_m, px) => `${Number(px) * 0.5}px`)
  ctx.fillStyle = 'rgba(41,121,255,0.08)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 0, 0)
  return c.toDataURL('image/png')
}
