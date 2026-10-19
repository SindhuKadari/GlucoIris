import { StrictMode, Suspense, lazy, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, RouterProvider, useRouteError } from 'react-router-dom'
import './index.css'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import AppShell from './components/AppShell'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const PatientPage = lazy(() => import('./pages/PatientPage'))
const NewScreeningPage = lazy(() => import('./pages/NewScreeningPage'))
const AcquisitionPage = lazy(() => import('./pages/AcquisitionPage'))
const QualityPage = lazy(() => import('./pages/QualityPage'))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const ReportPage = lazy(() => import('./pages/ReportPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))

function Loading() {
  return <div className="skeleton mx-auto mt-10 h-1 w-48 rounded-full" />
}

function RouteError() {
  const err = useRouteError() as (Error & { status?: number }) | undefined
  const notFound = !err || err.status === 404
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-abyss p-6 text-center text-ink">
      <h1 className="text-xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="max-w-md text-sm text-haze">{notFound ? 'The address does not match any GlucoIris page.' : err?.message}</p>
      <Link to="/dashboard" className="text-sm text-cyan hover:underline">Go to dashboard</Link>
    </div>
  )
}

const page = (el: ReactElement) => <Suspense fallback={<Loading />}>{el}</Suspense>

const router = createBrowserRouter([
  { path: '/', element: <LandingPage />, errorElement: <RouteError /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: '/dashboard', element: page(<DashboardPage />) },
      { path: '/patients/:id', element: page(<PatientPage />) },
      { path: '/screenings/new', element: page(<NewScreeningPage />) },
      { path: '/screenings/:id/acquisition', element: page(<AcquisitionPage />) },
      { path: '/screenings/:id/quality', element: page(<QualityPage />) },
      { path: '/screenings/:id/analysis', element: page(<AnalysisPage />) },
      { path: '/screenings/:id/review', element: page(<ReviewPage />) },
      { path: '/screenings/:id/report', element: page(<ReportPage />) },
      { path: '/audit', element: page(<AuditPage />) },
    ],
  },
  { path: '*', element: <RouteError /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
