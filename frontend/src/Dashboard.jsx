import { useEffect, useState } from 'react'
import { acceptInvitation, createProject, deleteProject, getMyTasks, listInvitations, listProjects, rejectInvitation } from './api'
import Icon from './Icon'

const field = 'w-full rounded-xl bg-panel px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-card placeholder:text-navy/40'
const PRIORITY_COLOR = { HIGH: 'bg-rose-100 text-rose-800', MEDIUM: 'bg-amber-100 text-amber-800', LOW: 'bg-slate-100 text-slate-700' }
const STATUS_LABEL   = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }

// ---------------------------------------------------------------------------
// Create project modal
// ---------------------------------------------------------------------------

function CreateProjectModal({ onCreated, onClose }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      onCreated(await createProject(name.trim(), description.trim()))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 px-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-[28px] bg-white px-8 py-8 shadow-lg">
        <h3 className="text-lg font-medium">New project</h3>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <input className={field} placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <textarea className={`${field} min-h-20 resize-none`} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
          <div className="mt-1 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-full px-5 py-2 text-sm hover:bg-panel">Cancel</button>
            <button disabled={busy || !name.trim()} className="rounded-full bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50">
              {busy ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Invitations inbox modal
// ---------------------------------------------------------------------------

function InvitationsModal({ invitations, onAction, onClose }) {
  const [busy, setBusy] = useState(null)

  const act = async (projectId, action) => {
    setBusy(projectId)
    try {
      if (action === 'accept') await acceptInvitation(projectId)
      else await rejectInvitation(projectId)
      onAction()
    } catch { /* parent refreshes */ } finally { setBusy(null) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 px-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-[28px] bg-white px-8 py-8 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Project invitations</h3>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-panel">
            <Icon name="x" className="size-4" />
          </button>
        </div>
        {invitations.length === 0 ? (
          <p className="mt-6 text-sm font-light text-navy/60">No pending invitations.</p>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            {invitations.map((inv) => (
              <div key={inv.project_id} className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
                <div>
                  <p className="font-medium">{inv.project_name}</p>
                  <p className="mt-0.5 text-xs font-light text-navy/60">
                    Invited by <strong className="font-medium">{inv.invited_by_name}</strong> · {inv.role}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => act(inv.project_id, 'accept')} disabled={busy === inv.project_id}
                    className="flex-1 rounded-full bg-navy py-2 text-xs font-medium text-white hover:bg-navy/90 disabled:opacity-50">
                    {busy === inv.project_id ? 'Accepting...' : 'Accept'}
                  </button>
                  <button onClick={() => act(inv.project_id, 'reject')} disabled={busy === inv.project_id}
                    className="flex-1 rounded-full bg-rose-50 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard({ user, onOpenProject, onLogout }) {
  const [projects,    setProjects]    = useState([])
  const [invitations, setInvitations] = useState([])
  const [myTasks,     setMyTasks]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showCreate,  setShowCreate]  = useState(false)
  const [showInvites, setShowInvites] = useState(false)
  const [deletingId,  setDeletingId]  = useState(null)

  const refresh = () =>
    Promise.all([
      listProjects().catch(() => []),
      listInvitations().catch(() => []),
      getMyTasks().catch(() => []),
    ])
      .then(([projs, invs, tasks]) => { setProjects(projs); setInvitations(invs); setMyTasks(tasks) })
      .finally(() => setLoading(false))

  useEffect(() => { refresh() }, [])

  const handleCreated = (proj) => { setShowCreate(false); refresh(); onOpenProject(proj) }

  const handleDelete = async (e, projId) => {
    e.stopPropagation()
    if (!confirm('Delete this project and all its meetings? This cannot be undone.')) return
    setDeletingId(projId)
    try { await deleteProject(projId); refresh() }
    catch (err) { alert(err.message) }
    finally { setDeletingId(null) }
  }

  const totalMeetings = projects.reduce((s, p) => s + p.meeting_count, 0)
  const totalActions  = projects.reduce((s, p) => s + p.open_action_count, 0)

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl rounded-sm bg-white px-4 pb-12 shadow-sm sm:px-6">

        {/* Nav */}
        <nav className="flex flex-wrap items-center gap-4 py-4">
          <span className="text-2xl font-extrabold tracking-tight">quorum<span className="text-slate-card">.</span></span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm font-light sm:block">{user.name}</span>
            <button
              onClick={() => setShowInvites(true)}
              className="relative flex items-center gap-1.5 rounded-full bg-panel px-4 py-2 text-sm font-medium hover:bg-slate-card/30"
              title="Project invitations"
            >
              <Icon name="bell" className="size-4" />
              {invitations.length > 0 && (
                <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                  {invitations.length}
                </span>
              )}
            </button>
            <button onClick={onLogout} className="flex items-center gap-1.5 rounded-full bg-panel px-4 py-2 text-sm font-medium hover:bg-slate-card/30">
              <Icon name="logout" className="size-4" />
              Logout
            </button>
          </div>
        </nav>

        {/* Hero */}
        <header
          className="relative flex min-h-48 flex-col justify-end overflow-hidden rounded-[28px] px-8 py-8 text-white"
          style={{
            background:
              'radial-gradient(circle at 15% 85%, #5e8c78 0, transparent 45%),' +
              'radial-gradient(circle at 85% 15%, #86a9c8 0, transparent 40%),' +
              'linear-gradient(135deg, #26354f, #3d5876 55%, #6c8ba4)',
          }}
        >
          <p className="text-sm font-light text-white/70">Welcome back</p>
          <h1 className="text-3xl font-extrabold tracking-tight">{user.name}</h1>
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <span><strong className="text-xl font-semibold">{projects.length}</strong><span className="ml-1.5 text-white/70">Projects</span></span>
            <span><strong className="text-xl font-semibold">{totalMeetings}</strong><span className="ml-1.5 text-white/70">Meetings</span></span>
            <span><strong className="text-xl font-semibold">{totalActions}</strong><span className="ml-1.5 text-white/70">Open actions</span></span>
            <span><strong className="text-xl font-semibold">{myTasks.filter(t => t.status !== 'done').length}</strong><span className="ml-1.5 text-white/70">My open tasks</span></span>
            {invitations.length > 0 && (
              <button onClick={() => setShowInvites(true)} className="rounded-full bg-white/20 px-3 py-0.5 text-sm font-medium hover:bg-white/30">
                {invitations.length} pending invitation{invitations.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </header>

        {/* My Tasks */}
        {myTasks.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-medium">My tasks</h2>
            <p className="mt-1 text-sm font-light text-navy/60">Action items assigned to you across all projects.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {myTasks.map((t) => (
                <div key={`${t.meeting_id}-${t.action_id}`} className="flex flex-col gap-2 rounded-2xl bg-panel p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{t.task}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${PRIORITY_COLOR[t.priority]}`}>
                      {t.priority}
                    </span>
                  </div>
                  <p className="text-xs font-light text-navy/60">
                    <span className="font-medium">{t.project_name}</span> · {t.meeting_title}
                  </p>
                  <div className="mt-auto flex items-center justify-between">
                    {t.due_date
                      ? <span className="text-xs text-navy/50">Due {t.due_date}</span>
                      : <span />
                    }
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] text-navy">
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Projects */}
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-medium">Your projects</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-full bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy/90"
            >
              <Icon name="plus" className="size-4" />
              New project
            </button>
          </div>

          {loading ? (
            <p className="mt-8 text-sm font-light">Loading projects...</p>
          ) : projects.length === 0 ? (
            <div className="mt-12 flex flex-col items-center gap-4 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-panel">
                <Icon name="layers" className="size-8 text-slate-card" />
              </span>
              <p className="max-w-xs text-sm font-light">
                No projects yet. Create your first project to start analyzing meetings.
              </p>
              <button onClick={() => setShowCreate(true)} className="rounded-full bg-navy px-6 py-2.5 text-sm font-medium text-white hover:bg-navy/90">
                Create a project
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  userId={user.id}
                  deleting={deletingId === p.id}
                  onOpen={() => onOpenProject(p)}
                  onDelete={(e) => handleDelete(e, p.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {showCreate && <CreateProjectModal onCreated={handleCreated} onClose={() => setShowCreate(false)} />}
      {showInvites && (
        <InvitationsModal
          invitations={invitations}
          onAction={() => { refresh(); if (invitations.length <= 1) setShowInvites(false) }}
          onClose={() => setShowInvites(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({ project: p, userId, deleting, onOpen, onDelete }) {
  const isOwner = p.created_by === userId
  return (
    <div className="flex flex-col rounded-2xl bg-linear-to-b from-slate-card to-navy p-5 text-white">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold leading-tight">{p.name}</h3>
        {isOwner && (
          <button onClick={onDelete} disabled={deleting} title="Delete project"
            className="grid size-7 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/15 hover:text-rose-300 disabled:opacity-40">
            {deleting
              ? <span className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              : <Icon name="trash" className="size-4" />
            }
          </button>
        )}
      </div>
      {p.description && <p className="mt-1 line-clamp-2 text-xs font-light text-white/70">{p.description}</p>}
      <div className="mt-4 flex gap-4 text-sm">
        <span><strong>{p.meeting_count}</strong><span className="ml-1 text-xs text-white/70">meetings</span></span>
        <span><strong>{p.open_action_count}</strong><span className="ml-1 text-xs text-white/70">open actions</span></span>
        <span><strong>{p.member_count}</strong><span className="ml-1 text-xs text-white/70">members</span></span>
      </div>
      <div className="mt-5 flex gap-2">
        <button onClick={onOpen} className="flex-1 rounded-full bg-white/15 py-2 text-xs font-medium hover:bg-white/25">
          Open project
        </button>
        <button onClick={onOpen} className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-xs font-medium text-navy hover:bg-white/90">
          <Icon name="analyze" className="size-3.5" />
          New meeting
        </button>
      </div>
    </div>
  )
}
