import type { Clinician } from '../types/domain'

export const DEMO_CLINICIAN: Clinician = {
  id: 'clin_demo',
  displayName: 'Dr. Demo Clinician',
  organisation: 'GlucoIris Demonstration Clinic',
  role: 'clinician',
  email: 'demo@glucoiris.local',
}

export const isRealAuthConfigured = () => Boolean(import.meta.env.VITE_API_BASE_URL)
