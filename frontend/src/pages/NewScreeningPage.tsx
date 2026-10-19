import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Search, UserPlus, Users } from 'lucide-react'
import type { DiabetesType, Patient } from '../types/domain'
import { useStore } from '../store/store'
import { Button, Card, CardHeader, Field, Input, Notice, PageHeader, Select, Textarea } from '../components/ui'
import { ageFrom, cx, IMAGE_SLOTS, uid } from '../lib/util'
import { StepBar } from '../features/screening/common'
import { tr, useT } from '../lib/i18n'

interface RegForm {
  clinicPatientId: string
  name: string
  dateOfBirth: string
  age: string
  sex: Patient['sex'] | ''
  diabetesType: DiabetesType | ''
  diabetesSinceYear: string
  hba1c: string
  hba1cDate: string
  symptoms: string
  notes: string
}

const emptyReg: RegForm = { clinicPatientId: '', name: '', dateOfBirth: '', age: '', sex: '', diabetesType: '', diabetesSinceYear: '', hba1c: '', hba1cDate: '', symptoms: '', notes: '' }

export function validateRegistration(f: RegForm, existing: Patient[]): Partial<Record<keyof RegForm, string>> {
  const e: Partial<Record<keyof RegForm, string>> = {}
  const today = new Date().toISOString().slice(0, 10)
  if (!f.clinicPatientId.trim()) e.clinicPatientId = tr('Patient ID is required.')
  else if (existing.some((p) => p.clinicPatientId.toLowerCase() === f.clinicPatientId.trim().toLowerCase())) e.clinicPatientId = tr('A patient with this ID is already registered.')
  if (!f.name.trim()) e.name = tr('Name is required.')
  if (!f.dateOfBirth && !f.age) e.dateOfBirth = tr('Enter a date of birth or an age.')
  if (f.dateOfBirth && f.dateOfBirth > today) e.dateOfBirth = tr('Date of birth cannot be in the future.')
  if (f.age && (!/^\d+$/.test(f.age) || +f.age < 0 || +f.age > 120)) e.age = tr('Enter an age between 0 and 120.')
  const year = new Date().getFullYear()
  if (f.diabetesSinceYear && (!/^\d{4}$/.test(f.diabetesSinceYear) || +f.diabetesSinceYear > year || +f.diabetesSinceYear < 1920)) e.diabetesSinceYear = tr('Enter a year between 1920 and {year}.', { year })
  if (f.hba1c) {
    const v = Number(f.hba1c)
    if (Number.isNaN(v) || v < 3 || v > 20) e.hba1c = tr('HbA1c should be between 3 and 20 %.')
    if (!f.hba1cDate) e.hba1cDate = tr('Record when HbA1c was measured.')
    else if (f.hba1cDate > today) e.hba1cDate = tr('Measurement date cannot be in the future.')
  }
  return e
}

export default function NewScreeningPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const patients = useStore((s) => s.patients)
  const session = useStore((s) => s.session)
  const addPatient = useStore((s) => s.addPatient)
  const createEncounter = useStore((s) => s.createEncounter)

  const [tab, setTab] = useState<'existing' | 'register'>(params.get('register') ? 'register' : 'existing')
  const [selected, setSelected] = useState<string | null>(params.get('patient'))
  const [search, setSearch] = useState('')
  const [reg, setReg] = useState<RegForm>(emptyReg)
  const [regErrors, setRegErrors] = useState<Partial<Record<keyof RegForm, string>>>({})

  const [consent, setConsent] = useState(false)
  const [consentMethod, setConsentMethod] = useState<'verbal' | 'written' | 'programme_policy'>('verbal')
  const [operator, setOperator] = useState(session?.clinician.displayName ?? '')
  const [device, setDevice] = useState('')
  const [idempotencyKey] = useState(() => uid('idem'))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const t = useT()

  const list = useMemo(() => {
    const t = search.trim().toLowerCase()
    return patients.filter((p) => !t || p.name.toLowerCase().includes(t) || p.clinicPatientId.toLowerCase().includes(t))
  }, [patients, search])

  const set = <K extends keyof RegForm>(k: K, v: RegForm[K]) => setReg((r) => ({ ...r, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errs: string[] = []
    let patientId = selected
    if (tab === 'register') {
      const re = validateRegistration(reg, patients)
      setRegErrors(re)
      if (Object.keys(re).length) errs.push(t('Complete the patient registration fields marked in red.'))
    } else if (!patientId) errs.push(t('Select a patient, or register a new one.'))
    if (!consent) errs.push(t('Confirm that consent was obtained before screening.'))
    if (!operator.trim()) errs.push(t('Enter the screening operator.'))
    setErrors(errs)
    if (errs.length) return

    setBusy(true)
    if (tab === 'register') {
      const p = addPatient({
        clinicPatientId: reg.clinicPatientId.trim(),
        name: reg.name.trim(),
        dateOfBirth: reg.dateOfBirth || undefined,
        age: reg.age ? Number(reg.age) : undefined,
        sex: reg.sex || undefined,
        diabetesType: reg.diabetesType || undefined,
        diabetesSinceYear: reg.diabetesSinceYear ? Number(reg.diabetesSinceYear) : undefined,
        hba1c: reg.hba1c ? { value: Number(reg.hba1c), measuredOn: reg.hba1cDate } : undefined,
        symptoms: reg.symptoms.trim() || undefined,
        notes: reg.notes.trim() || undefined,
      })
      patientId = p.id
    }
    const enc = createEncounter({
      patientId: patientId!,
      operator: operator.trim(),
      consent: { obtained: true, method: consentMethod, recordedBy: operator.trim(), recordedAt: new Date().toISOString() },
      eyesPlanned: IMAGE_SLOTS,
      device: device.trim() || undefined,
      idempotencyKey,
    })
    navigate(`/screenings/${enc.id}/acquisition`)
  }

  const selectedPatient = patients.find((p) => p.id === selected)

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader eyebrow={t('New screening')} title={t('Start a screening encounter')} description={t('Select or register the patient and record consent. One retinal fundus image is captured next.')} />

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <Card>
          <div className="flex border-b border-line" role="tablist">
            {[
              { key: 'existing' as const, label: t('Existing patient'), icon: Users },
              { key: 'register' as const, label: t('Register new patient'), icon: UserPlus },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx('flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3.5 text-sm transition-colors', tab === t.key ? 'border-electric text-ink' : 'border-transparent text-haze hover:text-ink')}
              >
                <t.icon size={16} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'existing' ? (
            <div className="p-5">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-haze" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search by name or patient ID')} className="pl-9" aria-label={t('Search patients')} />
              </div>
              <ul className="mt-3 max-h-[calc(100dvh-420px)] min-h-[200px] space-y-1.5 overflow-y-auto" role="listbox" aria-label={t('Patients')}>
                {list.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected === p.id}
                      onClick={() => setSelected(p.id)}
                      className={cx('flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors', selected === p.id ? 'border-electric bg-electric/10' : 'border-line hover:bg-panel-2')}
                    >
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-haze">
                          <span className="font-mono">{p.clinicPatientId}</span> · {t('{age} y', { age: ageFrom(p.dateOfBirth, p.age) ?? '—' })}
                        </div>
                      </div>
                      {selected === p.id && <Check size={16} className="text-cyan" />}
                    </button>
                  </li>
                ))}
                {!list.length && <li className="py-6 text-center text-sm text-haze">{t('No patients match. Register a new patient instead.')}</li>}
              </ul>
            </div>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label={t('Clinic patient ID')} required error={regErrors.clinicPatientId} htmlFor="r-id">
                <Input id="r-id" value={reg.clinicPatientId} onChange={(e) => set('clinicPatientId', e.target.value)} aria-invalid={!!regErrors.clinicPatientId} placeholder={t('e.g. GI-2001')} />
              </Field>
              <Field label={t('Full name')} required error={regErrors.name} htmlFor="r-name">
                <Input id="r-name" value={reg.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!regErrors.name} autoComplete="off" />
              </Field>
              <Field label={t('Date of birth')} error={regErrors.dateOfBirth} hint={t('Or enter age instead')} htmlFor="r-dob">
                <Input id="r-dob" type="date" value={reg.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} aria-invalid={!!regErrors.dateOfBirth} />
              </Field>
              <Field label={t('Age (years)')} error={regErrors.age} htmlFor="r-age">
                <Input id="r-age" inputMode="numeric" value={reg.age} onChange={(e) => set('age', e.target.value)} aria-invalid={!!regErrors.age} disabled={!!reg.dateOfBirth} />
              </Field>
              <Field label={t('Sex')} htmlFor="r-sex">
                <Select id="r-sex" value={reg.sex} onChange={(e) => set('sex', e.target.value as RegForm['sex'])}>
                  <option value="">{t('Not recorded')}</option>
                  <option value="female">{t('Female')}</option>
                  <option value="male">{t('Male')}</option>
                  <option value="other">{t('Other')}</option>
                  <option value="undisclosed">{t('Prefer not to say')}</option>
                </Select>
              </Field>
              <Field label={t('Diabetes type')} htmlFor="r-dt">
                <Select id="r-dt" value={reg.diabetesType} onChange={(e) => set('diabetesType', e.target.value as RegForm['diabetesType'])}>
                  <option value="">{t('Not recorded')}</option>
                  <option value="type1">{t('Type 1')}</option>
                  <option value="type2">{t('Type 2')}</option>
                  <option value="gestational">{t('Gestational')}</option>
                  <option value="other">{t('Other')}</option>
                  <option value="unknown">{t('Unknown')}</option>
                </Select>
              </Field>
              <Field label={t('Diagnosed in (year)')} error={regErrors.diabetesSinceYear} htmlFor="r-since">
                <Input id="r-since" inputMode="numeric" value={reg.diabetesSinceYear} onChange={(e) => set('diabetesSinceYear', e.target.value)} aria-invalid={!!regErrors.diabetesSinceYear} placeholder={t('YYYY')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('HbA1c (%)')} error={regErrors.hba1c} htmlFor="r-a1c">
                  <Input id="r-a1c" inputMode="decimal" value={reg.hba1c} onChange={(e) => set('hba1c', e.target.value)} aria-invalid={!!regErrors.hba1c} />
                </Field>
                <Field label={t('Measured on')} error={regErrors.hba1cDate} htmlFor="r-a1cd">
                  <Input id="r-a1cd" type="date" value={reg.hba1cDate} onChange={(e) => set('hba1cDate', e.target.value)} aria-invalid={!!regErrors.hba1cDate} />
                </Field>
              </div>
              <Field label={t('Visual symptoms')} htmlFor="r-sym">
                <Textarea id="r-sym" value={reg.symptoms} onChange={(e) => set('symptoms', e.target.value)} className="min-h-[64px]" />
              </Field>
              <Field label={t('Clinical notes')} hint={t('Avoid unnecessary identifying information.')} htmlFor="r-notes">
                <Textarea id="r-notes" value={reg.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-[64px]" />
              </Field>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t('Encounter details')} subtitle={selectedPatient && tab === 'existing' ? t('For {name}', { name: selectedPatient.name }) : undefined} />
            <div className="space-y-5 p-5">
              <p className="rounded-lg border border-line bg-panel-2 px-3 py-3 text-sm text-haze">
                {t('This screening captures one retinal fundus image.')}
              </p>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-xs font-medium text-ink/90">{t('Consent')}</legend>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#245CEB]" />
                  <span>{t('Consent for retinal imaging and AI-assisted screening was obtained according to the programme workflow.')}</span>
                </label>
                <Select value={consentMethod} onChange={(e) => setConsentMethod(e.target.value as typeof consentMethod)} aria-label={t('Consent method')}>
                  <option value="verbal">{t('Verbal consent')}</option>
                  <option value="written">{t('Written consent')}</option>
                  <option value="programme_policy">{t('Programme enrolment policy')}</option>
                </Select>
              </fieldset>

              <Field label={t('Screening operator')} required htmlFor="op">
                <Input id="op" value={operator} onChange={(e) => setOperator(e.target.value)} />
              </Field>
              <Field label={t('Camera / device')} hint={t('Recorded with each image for future device-specific evaluation.')} htmlFor="dev">
                <Input id="dev" value={device} onChange={(e) => setDevice(e.target.value)} placeholder={t('e.g. Tabletop fundus camera, 45° field')} />
              </Field>
            </div>
          </Card>

          {errors.length > 0 && (
            <Notice tone="bad" title={t('Please fix the following')}>
              <ul className="list-disc space-y-0.5 pl-4">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          )}

        </div>
      </div>

      <StepBar
        back={{ to: '/dashboard', label: t('Dashboard') }}
        status={
          tab === 'existing'
            ? selectedPatient
              ? t('Patient: {name}. Confirm consent, then continue.', { name: selectedPatient.name })
              : t('Select a patient, or register a new one.')
            : t('Fill in the patient details and confirm consent, then continue.')
        }
      >
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          <span className="md:hidden">{t('Continue')}</span><span className="hidden md:inline">{t('Continue to image capture')}</span> <ArrowRight size={18} />
        </Button>
      </StepBar>
    </form>
  )
}
