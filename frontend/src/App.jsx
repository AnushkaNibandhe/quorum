/**
 * App.jsx — top-level router (no react-router; plain state machine)
 *
 * View hierarchy:
 *   auth → dashboard → project → analyze → results
 *                             ↘ graph (full-screen dependency graph)
 */
import { useEffect, useState } from 'react'
import { getMe, token } from './api'
import Analyze from './Analyze'
import AuthPage from './AuthPage'
import Dashboard from './Dashboard'
import DependencyGraph from './DependencyGraph'
import ProjectWorkspace from './ProjectWorkspace'
import Results from './Results'

export default function App() {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  // 'auth' | 'dashboard' | 'project' | 'analyze' | 'results' | 'graph'
  const [view,          setView]          = useState('auth')
  const [activeProject, setActiveProject] = useState(null)
  const [activeMeeting, setActiveMeeting] = useState(null)

  // Bootstrap: restore session from stored JWT
  useEffect(() => {
    if (!token.get()) { setLoading(false); return }
    getMe()
      .then((me) => { setUser({ id: me.user_id, name: me.name, email: me.email }); setView('dashboard') })
      .catch(() => token.clear())
      .finally(() => setLoading(false))
  }, [])

  const handleAuth    = (u)  => { setUser(u); setView('dashboard') }
  const handleLogout  = ()   => { token.clear(); setUser(null); setActiveProject(null); setActiveMeeting(null); setView('auth') }
  const handleOpenProject = (p) => { setActiveProject(p); setActiveMeeting(null); setView('project') }
  const handleAnalyze = ()   => setView('analyze')
  const handleResult  = (m)  => { setActiveMeeting(m); setView('results') }
  const handleResultSaved   = (m) => setActiveMeeting(m)
  const handleResultDeleted = ()  => { setActiveMeeting(null); setView('project') }
  const handleOpenGraph = ()  => setView('graph')

  // ── Splash ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-2xl font-extrabold tracking-tight text-navy/40 animate-pulse">
          quorum<span className="text-slate-card">.</span>
        </span>
      </div>
    )
  }

  if (view === 'auth' || !user) return <AuthPage onAuth={handleAuth} />

  if (view === 'dashboard') {
    return <Dashboard user={user} onOpenProject={handleOpenProject} onLogout={handleLogout} />
  }

  if (view === 'project' && activeProject) {
    return (
      <ProjectWorkspace
        project={activeProject}
        user={user}
        onBack={() => setView('dashboard')}
        onAnalyze={handleAnalyze}
        onLogout={handleLogout}
        onOpenGraph={handleOpenGraph}
      />
    )
  }

  if (view === 'analyze' && activeProject) {
    return (
      <Analyze
        project={activeProject}
        onResult={handleResult}
        onBack={() => setView('project')}
      />
    )
  }

  // Full-screen dependency graph
  if (view === 'graph' && activeProject) {
    return (
      <DependencyGraph
        projectId={activeProject.id}
        projectName={activeProject.name}
        onBack={() => setView('project')}
      />
    )
  }

  if (view === 'results' && activeMeeting) {
    return (
      <div className="px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-6xl rounded-sm bg-white px-4 pb-12 shadow-sm sm:px-6">
          <nav className="flex flex-wrap items-center gap-4 py-4">
            <span className="text-2xl font-extrabold tracking-tight">
              quorum<span className="text-slate-card">.</span>
            </span>
            <div className="ml-4 flex items-center gap-2 text-sm text-navy/60">
              <button onClick={() => setView('dashboard')} className="hover:text-navy">Dashboard</button>
              <span>/</span>
              <button onClick={() => setView('project')} className="hover:text-navy">{activeProject.name}</button>
              <span>/</span>
              <span className="font-medium text-navy">{activeMeeting.title}</span>
            </div>
            <div className="ml-auto flex gap-2">
              <button
                onClick={handleOpenGraph}
                className="flex items-center gap-1.5 rounded-full bg-panel px-4 py-2 text-sm font-medium hover:bg-slate-card/30"
              >
                Dependency Graph
              </button>
              <button
                onClick={() => setView('project')}
                className="rounded-full bg-panel px-4 py-2 text-sm font-medium hover:bg-slate-card/30"
              >
                ← Back to project
              </button>
            </div>
          </nav>

          <Results
            key={activeMeeting.id}
            meeting={activeMeeting}
            members={[]}
            isOwner={false}
            onSaved={handleResultSaved}
            onDeleted={handleResultDeleted}
            onOpenGraph={handleOpenGraph}
          />
        </div>
      </div>
    )
  }

  // Fallback
  return <Dashboard user={user} onOpenProject={handleOpenProject} onLogout={handleLogout} />
}
