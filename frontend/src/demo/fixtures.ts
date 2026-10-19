import manifest from './fixtures.json'
import type { Fixture, Grade } from '../types/domain'

export const FIXTURES = manifest.fixtures as Fixture[]
export const DATASET_ATTRIBUTION = manifest.attribution as Record<string, string>

export const fixtureById = (id: string) => FIXTURES.find((f) => f.id === id)

/**
 * Scripted demo behaviour per fixture. Every value here is SIMULATED — chosen to
 * exercise the interface (agreement, disagreement, uncertainty, partial failure),
 * not produced by any model.
 */
export interface FixtureScript {
  probabilities?: [number, number, number, number, number]
  attributionFailsFirstAttempt?: boolean
  story?: string
}

export const FIXTURE_SCRIPTS: Record<string, FixtureScript> = {
  'idrid-105': {
    probabilities: [0.08, 0.44, 0.3, 0.12, 0.06],
    story: 'Predicted grade (mild) and referable flag disagree — both are shown.',
  },
  'idrid-012': {
    probabilities: [0.05, 0.12, 0.3, 0.31, 0.22],
    story: 'Low top-class score — reported as “Unable to determine — review required”.',
  },
  'idrid-016': {
    probabilities: [0.02, 0.06, 0.33, 0.47, 0.12],
    story: 'Simulated output differs from the dataset reference grade.',
  },
  'idrid-029': {
    attributionFailsFirstAttempt: true,
    story: 'Attribution module fails on the first attempt to demonstrate partial failure and retry.',
  },
}

export const DEMO_REFERABLE_THRESHOLD = 0.4
export const DEMO_DETERMINABLE_MIN = 0.4

export function referenceGradeLabel(f: Fixture): string {
  if (f.referenceGrade === null) return 'No grade label in source dataset'
  return `Grade ${f.referenceGrade as Grade} (${f.dataset} reference label)`
}
