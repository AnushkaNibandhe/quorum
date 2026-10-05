import { useEffect, useState } from 'react'
import { getMeeting, listMeetings } from './api'
import Analyze from './Analyze'
import Results from './Results'
import Icon from './Icon'

const FEATURES = [
  { icon: 'quote', title: 'Evidence for every item', body: 'Each decision, task and risk links back to the exact line in your notes, so nothing is taken on faith.' },
  { icon: 'layers', title: 'Any meeting format', body: 'Typed notes, PDFs, handwritten pages, whiteboard photos and recordings all run through the same engine.' },
  { icon: 'shield', title: 'You stay in control', body: 'Low-confidence items are flagged for review before anything leaves the room.' },
]

const STEPS = [
  { n: 1, title: 'Capture the meeting', body: 'Paste raw notes, however messy.' },
  { n: 2, title: 'Review what AI found', body: 'Check owners, dates and evidence.' },
  { n: 3, title: 'Act on it', body: 'Export or push tasks to your tools.' },
]

const TONE = { positive: 'bg-emerald-100 text-emerald-800', neutral: 'bg-white/80 text-navy', concern: 'bg-amber-100 text-amber-800', conflict: 'bg-rose-100 text-rose-800' }

export default function App() {
  const [meetings, setMeetings] = useState([])
  const [current, setCurrent] = useState(null)
  const [query, setQuery] = useState('')
  const [project, setProject] = useState('All')

  const refresh = () => listMeetings().then(setMeetings).catch(() => setMeetings([]))
  useEffect(() => { refresh() }, [])

  const show = (meeting) => {
    setCurrent(meeting)
    setTimeout(() => document.getElementById('results')?.scrollIntoView(), 0)
  }
  const open = (id) => getMeeting(id).then(show)

  const totals = meetings.reduce(
    (t, m) => ({ actions: t.actions + m.counts.actions, decisions: t.decisions + m.counts.decisions }),
    { actions: 0, decisions: 0 },
  )
  const q = query.toLowerCase()
  const projects = ['All', ...new Set(meetings.map((m) => m.project))]
  const filtered = meetings.filter(
    (m) => (project === 'All' || m.project === project) && `${m.title} ${m.project} ${m.team}`.toLowerCase().includes(q),
  )

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl rounded-sm bg-white px-4 pb-12 shadow-sm sm:px-6">
        {/* Nav */}
        <nav className="flex flex-wrap items-center gap-4 py-4">
          <a href="#" className="text-2xl font-extrabold tracking-tight">quorum<span className="text-slate-card">.</span></a>
          <div className="hidden gap-6 text-sm font-medium md:flex">
            <a href="#analyze" className="hover:text-slate-card">Analyze</a>
            <a href="#meetings" className="hover:text-slate-card">Meetings</a>
            <a href="#how" className="hover:text-slate-card">How it works</a>
          </div>
          <label className="ml-auto flex w-full items-center gap-2 rounded-full bg-panel px-4 py-2 text-sm sm:w-72">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); document.getElementById('meetings')?.scrollIntoView() }}
              placeholder="Search meetings, projects, teams..."
              className="w-full bg-transparent outline-none placeholder:text-navy/50"
            />
            <Icon name="search" className="size-4 shrink-0" />
          </label>
          <a href="#analyze" className="rounded-full bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy/90">New meeting</a>
        </nav>

        {/* Hero */}
        <header
          className="relative flex min-h-105 flex-col justify-center overflow-hidden rounded-[28px] px-6 py-12 text-white sm:px-14"
          style={{
            background:
              'repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 34px),' +
              'radial-gradient(circle at 15% 85%, #5e8c78 0, transparent 45%),' +
              'radial-gradient(circle at 85% 15%, #86a9c8 0, transparent 40%),' +
              'linear-gradient(135deg, #26354f, #3d5876 55%, #6c8ba4)',
          }}
        >
          <h1 className="relative w-fit text-[clamp(64px,15vw,190px)] leading-[0.85] font-extrabold tracking-tight">
            QUORUM<span className="absolute -right-8 bottom-2 text-base font-semibold tracking-normal sm:-right-10">AI</span>
          </h1>
          <p className="mt-6 max-w-lg text-sm text-white/90 sm:text-base">
            Turn messy meeting notes into decisions, owners, deadlines and risks, each one backed by evidence from what was actually said.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm font-medium">
            <a href="#analyze" className="rounded-full bg-white px-5 py-2 text-navy hover:bg-white/90">Analyze a meeting</a>
            <a href="#meetings" className="rounded-full border border-white px-5 py-2 hover:bg-white/10">View past meetings</a>
          </div>
        </header>

        {/* Why */}
        <section className="grid gap-10 px-2 py-16 sm:px-8 lg:grid-cols-[1fr_380px]">
          <div>
            <h2 className="max-w-md text-2xl font-medium">Why teams use Quorum to turn meetings into momentum</h2>
            <p className="mt-4 max-w-lg text-sm font-light">
              Meeting outcomes get trapped in scribbled notes and long transcripts. Quorum pulls out who agreed to what and by when, and shows you exactly where it heard it.
            </p>
            <div className="mt-12 grid max-w-md grid-cols-3 gap-4 text-center">
              {[
                ['check', meetings.length, 'Meetings analyzed'],
                ['calendar', totals.actions, 'Action items extracted'],
                ['quote', totals.decisions, 'Decisions tracked'],
              ].map(([icon, value, label]) => (
                <div key={label} className="flex flex-col items-center">
                  <span className="grid size-11 place-items-center rounded-full bg-navy text-white"><Icon name={icon} className="size-5" /></span>
                  <span className="mt-3 text-lg font-semibold">{value}</span>
                  <span className="text-xs font-light">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4 rounded-2xl bg-slate-card p-3 text-white">
                <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-white/90 text-navy"><Icon name={f.icon} className="size-10" /></span>
                <div>
                  <h3 className="font-medium">{f.title}</h3>
                  <p className="mt-1 text-xs font-light text-white/90">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <Analyze meetings={meetings} onResult={(m) => { show(m); refresh() }} />
        {current && (
          <Results
            key={current.id}
            meeting={current}
            onSaved={(m) => { setCurrent(m); refresh() }}
            onDeleted={() => { setCurrent(null); refresh() }}
          />
        )}

        {/* Recent meetings */}
        <section id="meetings" className="mt-16 scroll-mt-6 rounded-[28px] bg-panel px-4 py-10 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-xl font-medium">Recent meetings</h2>
            <p className="max-w-sm text-sm font-light">Every analyzed meeting is saved, so decisions and commitments can be tracked across time.</p>
          </div>
          {projects.length > 2 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {projects.map((p) => (
                <button
                  key={p}
                  onClick={() => setProject(p)}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium ${project === p ? 'bg-navy text-white' : 'bg-white hover:bg-slate-card/30'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="mt-8 text-sm font-light">{meetings.length ? 'No meetings match your search.' : 'No meetings yet. Analyze your first one above.'}</p>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => open(m.id)}
                  className="flex min-h-56 flex-col rounded-2xl bg-linear-to-b from-slate-card to-navy p-4 text-left text-white transition hover:-translate-y-1"
                >
                  <span className="flex w-full justify-between gap-2">
                    <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium">
                      {m.counts.pending ? `${m.counts.pending} to review` : 'Reviewed'}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-medium capitalize ${TONE[m.tone]}`}>{m.tone}</span>
                  </span>
                  <span className="mt-auto text-lg leading-tight font-medium">{m.title}</span>
                  <span className="mt-1 text-xs text-white/80">{m.project} · {m.team}</span>
                  <span className="mt-1 text-xs text-white/80">{m.meeting_date}</span>
                  <span className="mt-3 flex gap-3 text-xs">
                    <span>{m.counts.decisions} decisions</span>
                    <span>{m.counts.actions} actions</span>
                    <span>{m.counts.risks} risks</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-6 px-2 pt-16 sm:px-8">
          <h2 className="text-xl font-medium">From meeting to momentum in 1-2-3.</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-navy/20 font-semibold">{s.n}</span>
                <div>
                  <h3 className="font-medium">{s.title}</h3>
                  <p className="text-sm font-light">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}