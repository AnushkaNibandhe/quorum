import { useEffect, useState } from 'react'
import { addProjectMember, getMeeting, listProjectMembers, listProjectMeetings } from './api'
import DependencyHealth from './DependencyHealth'
import Icon from './Icon'
import Results from './Results'

const TONE = {
  positive: 'bg-emerald-100 text-emerald-800',
  neutral:  'bg-white/80 text-navy',
  concern:  'bg-amber-100 text-amber-800',
  conflict: 'bg-rose-100 text-rose-800',
}
const PRIORITY_COLOR = { HIGH: 'bg-rose-100 text-rose-800', MEDIUM: 'bg-amber-100 text-amber-800', LOW: 'bg-slate-100 text-slate-700' }
const STATUS_LABEL   = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProjectWorkspace({ project, user, onBack, onAnalyze, onLogout, onOpenGraph }) {
  const [meetings, setMeetings] = useState([])
  const [members,  setMembers]  = useState([])
  const [current,  setCurrent]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [view, setView] = useState('overview') // overview | meetings | tasks | graph | meeting-detail

  const refresh = () =>
    Promise.all([
      listProjectMeetings(project.id),
      listProjectMembers(project.id),
    ])
      .then(([m, mb]) => { setMeetings(m); setMembers(mb) })
      .catch(() => {})
      .finally(() => setLoading(false))

  useEffect(() => { refresh() }, [project.id])

  const openMeeting = (id) =>
    getMeeting(id).then((m) => { setCurrent(m); setView('meeting-detail') })

  const decisions = meetings.reduce((s, m) => s + (m.counts?.decisions ?? 0), 0)
  const actions   = meetings.reduce((s, m) => s + (m.counts?.actions   ?? 0), 0)
  const risks     = meetings.reduce((s, m) => s + (m.counts?.risks     ?? 0), 0)

  const isOwner = members.find((m) => m.user_id === user.id)?.role === 'OWNER'
  const recentMeetings = meetings.slice(0, 5)

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl rounded-sm bg-white px-4 pb-12 shadow-sm sm:px-6">

        {/* Nav */}
        <nav className="flex flex-wrap items-center gap-4 py-4">
          <span className="text-2xl font-extrabold tracking-tight">
            quorum<span className="text-slate-card">.</span>
          </span>
          <div className="ml-4 flex items-center gap-2 text-sm text-navy/60">
            <button onClick={onBack} className="hover:text-navy">Dashboard</button>
            <span>/</span>
            <span className="font-medium text-navy">{project.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onAnalyze}
              className="flex items-center gap-2 rounded-full bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy/90"
            >
              <Icon name="analyze" className="size-4" />
              Analyze meeting
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 rounded-full bg-panel px-4 py-2 text-sm font-medium hover:bg-slate-card/30"
            >
              <Icon name="logout" className="size-4" />
              Logout
            </button>
          </div>
        </nav>

        {/* Project hero */}
        <header
          className="relative flex min-h-52 flex-col justify-end overflow-hidden rounded-[28px] px-8 py-8 text-white"
          style={{
            background:
              'radial-gradient(circle at 10% 90%, #5e8c78 0, transparent 50%),' +
              'radial-gradient(circle at 90% 10%, #86a9c8 0, transparent 40%),' +
              'linear-gradient(135deg, #26354f, #3d5876 55%, #6c8ba4)',
          }}
        >
          <p className="text-xs font-light uppercase tracking-widest text-white/60">Project</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="mt-1 max-w-lg text-sm font-light text-white/80">{project.description}</p>
          )}
          <div className="mt-5 flex flex-wrap gap-6 text-sm">
            {[
              [meetings.length, 'Meetings'],
              [actions,         'Action items'],
              [decisions,       'Decisions'],
              [risks,           'Risks'],
            ].map(([n, label]) => (
              <span key={label}>
                <strong className="text-xl font-semibold">{n}</strong>
                <span className="ml-1.5 text-white/70">{label}</span>
              </span>
            ))}
          </div>
        </header>

        {/* Sub-nav */}
        <div className="mt-6 flex gap-2">
          {['overview', 'meetings', 'tasks', 'graph'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-5 py-2 text-sm font-medium capitalize transition ${
                view === v ? 'bg-navy text-white' : 'bg-panel hover:bg-slate-card/30'
              }`}
            >
              {v === 'graph' ? 'Dependency Graph' : v}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW + MEETING DETAIL ─────────────────────────── */}
        {(view === 'overview' || view === 'meeting-detail') && (
          <>
            {/* Meeting detail — full width, no sidebar */}
            {view === 'meeting-detail' && current ? (
              <div className="mt-8">
                <button
                  onClick={() => setView('overview')}
                  className="mb-4 flex items-center gap-1 text-sm text-navy/60 hover:text-navy"
                >
                  <Icon name="chevron-left" className="size-4" /> Back to overview
                </button>
                <Results
                  key={current.id}
                  meeting={current}
                  members={members}
                  isOwner={isOwner}
                  onOpenGraph={() => setView('graph')}
                  onSaved={(m) => { setCurrent(m); refresh() }}
                  onDeleted={() => { setCurrent(null); setView('overview'); refresh() }}
                />
              </div>
            ) : (
              /* Overview — two-column layout with sidebar */
              <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_260px]">
                {/* Main column */}
                <div>
                  <h2 className="font-medium">Recent meetings</h2>
                  {loading ? (
                    <p className="mt-4 text-sm font-light">Loading...</p>
                  ) : recentMeetings.length === 0 ? (
                    <div className="mt-8 flex flex-col items-center gap-3 text-center">
                      <span className="grid size-14 place-items-center rounded-2xl bg-panel">
                        <Icon name="calendar" className="size-7 text-slate-card" />
                      </span>
                      <p className="text-sm font-light">No meetings yet.</p>
                      <button
                        onClick={onAnalyze}
                        className="rounded-full bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy/90"
                      >
                        Analyze your first meeting
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {recentMeetings.map((m) => (
                        <MeetingRow key={m.id} meeting={m} onClick={() => openMeeting(m.id)} />
                      ))}
                      {meetings.length > 5 && (
                        <button
                          onClick={() => setView('meetings')}
                          className="mt-2 text-sm font-medium underline underline-offset-4 hover:text-slate-card"
                        >
                          View all {meetings.length} meetings →
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Sidebar */}
                <aside>
                  <MembersSidebar
                    projectId={project.id}
                    members={members}
                    currentUserId={user.id}
                    onMemberAdded={refresh}
                  />
                  <DependencyHealth
                    projectId={project.id}
                    onOpenGraph={() => setView('graph')}
                  />
                </aside>
              </div>
            )}
          </>
        )}

        {/* ── ALL MEETINGS ──────────────────────────────────────── */}
        {view === 'meetings' && (
          <div className="mt-8">
            <h2 className="font-medium">All meetings</h2>
            {loading ? (
              <p className="mt-4 text-sm font-light">Loading...</p>
            ) : meetings.length === 0 ? (
              <p className="mt-4 text-sm font-light">No meetings yet.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {meetings.map((m) => (
                  <MeetingRow
                    key={m.id}
                    meeting={m}
                    onClick={() => { openMeeting(m.id); setView('meeting-detail') }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MY TASKS ──────────────────────────────────────────── */}
        {view === 'tasks' && (
          <MyTasksPanel
            projectMeetings={meetings}
            userId={user.id}
            onOpenMeeting={(id) => { openMeeting(id); setView('meeting-detail') }}
          />
        )}

        {/* ── DEPENDENCY GRAPH (inline summary + link out) ──────── */}
        {view === 'graph' && (
          <div className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-medium">Dependency Graph</h2>
              <button
                onClick={() => {
                  // Navigate to full-screen graph via App.jsx router
                  // We lift this up via onOpenGraph prop
                  if (typeof onOpenGraph === 'function') onOpenGraph()
                }}
                className="flex items-center gap-2 rounded-full bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy/90"
              >
                <Icon name="graph" className="size-4" />
                Open full graph
              </button>
            </div>
            <DependencyHealth
              projectId={project.id}
              onOpenGraph={onOpenGraph}
            />
          </div>
        )}

      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// My Tasks panel — fetches full meeting data and surfaces assigned actions
// ---------------------------------------------------------------------------

function MyTasksPanel({ projectMeetings, userId, onOpenMeeting }) {
  const [tasks,   setTasks]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (projectMeetings.length === 0) { setTasks([]); setLoading(false); return }
    Promise.all(projectMeetings.map((m) => getMeeting(m.id)))
      .then((full) => {
        const found = []
        for (const mtg of full) {
          for (const action of (mtg.result?.action_items ?? [])) {
            if (action.assigned_to_id === userId) {
              found.push({ ...action, meeting_id: mtg.id, meeting_title: mtg.title })
            }
          }
        }
        const p = { HIGH: 0, MEDIUM: 1, LOW: 2 }
        found.sort((a, b) =>
          (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) ||
          (p[a.priority] ?? 9) - (p[b.priority] ?? 9)
        )
        setTasks(found)
      })
      .catch(() => setTasks([]))
      .finally(() => setLoading(false))
  }, [projectMeetings, userId])

  return (
    <div className="mt-8">
      <h2 className="font-medium">My tasks</h2>
      <p className="mt-1 text-sm font-light text-navy/60">
        Action items assigned to you in this project.
      </p>

      {loading ? (
        <p className="mt-4 text-sm font-light">Loading...</p>
      ) : tasks.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-panel">
            <Icon name="check" className="size-7 text-slate-card" />
          </span>
          <p className="text-sm font-light">No tasks assigned to you yet.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tasks.map((t) => (
            <button
              key={`${t.meeting_id}-${t.id}`}
              onClick={() => onOpenMeeting(t.meeting_id)}
              className="flex items-start gap-3 rounded-2xl bg-panel p-4 text-left transition hover:-translate-y-0.5"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium leading-snug">{t.task}</p>
                <p className="mt-1 text-xs font-light text-navy/60">
                  From: <span className="font-medium">{t.meeting_title}</span>
                </p>
                {t.due_date && (
                  <p className="mt-0.5 text-xs text-navy/50">Due {t.due_date}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${PRIORITY_COLOR[t.priority]}`}>
                  {t.priority}
                </span>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-navy">
                  {STATUS_LABEL[t.status]}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Members sidebar — invite by email (owners only)
// ---------------------------------------------------------------------------

function MembersSidebar({ projectId, members, currentUserId, onMemberAdded }) {
  const [email,   setEmail]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  const currentMember = members.find((m) => m.user_id === currentUserId)
  const isOwner = currentMember?.role === 'OWNER'

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setError(''); setSuccess('')
    try {
      await addProjectMember(projectId, email.trim())
      setSuccess(`${email.trim()} invited.`)
      setEmail('')
      onMemberAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Members</h2>
        <span className="text-xs font-light text-navy/50">
          {members.length} member{members.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 rounded-xl bg-panel p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy text-sm font-semibold text-white">
              {m.name[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {m.name}
                {m.user_id === currentUserId && (
                  <span className="ml-1.5 text-xs font-light text-navy/40">(you)</span>
                )}
              </p>
              <p className="truncate text-xs font-light text-navy/60">{m.email}</p>
            </div>
            <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                m.role === 'OWNER' ? 'bg-navy text-white' : 'bg-white text-navy'
              }`}>
                {m.role}
              </span>
              {m.status === 'pending' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                  pending
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOwner && (
        <form onSubmit={submit} className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy/60">
            Invite by email
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); setSuccess('') }}
              placeholder="colleague@example.com"
              disabled={busy}
              className="min-w-0 flex-1 rounded-xl bg-panel px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-card placeholder:text-navy/40"
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              title="Invite member"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy text-white hover:bg-navy/90 disabled:opacity-50"
            >
              {busy
                ? <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                : <Icon name="plus" className="size-4" />
              }
            </button>
          </div>
          {error   && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
          {success && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">✓ {success}</p>}
          <p className="mt-2 text-[11px] font-light text-navy/40">
            They must already have a Quorum account.
          </p>
        </form>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Meeting row card
// ---------------------------------------------------------------------------

function MeetingRow({ meeting: m, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-wrap items-start gap-3 rounded-2xl bg-panel p-4 text-left transition hover:-translate-y-0.5"
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{m.title}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${TONE[m.tone] ?? TONE.neutral}`}>
            {m.tone}
          </span>
          <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] capitalize">
            {m.input_type}
          </span>
        </div>
        {m.summary && (
          <p className="mt-1 line-clamp-2 text-xs font-light text-navy/70">{m.summary}</p>
        )}
        <p className="mt-1 text-xs text-navy/50">{m.meeting_date}</p>
      </div>
      <div className="flex shrink-0 gap-3 text-xs font-light">
        <span>{m.counts.decisions} decisions</span>
        <span>{m.counts.actions} actions</span>
        <span>{m.counts.risks} risks</span>
      </div>
    </button>
  )
}
