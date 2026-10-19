import type { Encounter } from '../types/domain'

export const encounterPath = (e: Pick<Encounter, 'id' | 'status'>) => {
  const step = { acquisition: 'acquisition', quality: 'quality', analysis: 'analysis', awaiting_review: 'review', reviewed: 'report' }[e.status]
  return `/screenings/${e.id}/${step}`
}

export const ENCOUNTER_STATUS_LABEL: Record<Encounter['status'], string> = {
  acquisition: 'Image acquisition',
  quality: 'Quality check',
  analysis: 'Analysis',
  awaiting_review: 'Awaiting review',
  reviewed: 'Reviewed',
}
