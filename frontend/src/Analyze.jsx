import { useRef, useState } from 'react'
import { analyze, ingestFile } from './api'
import Icon from './Icon'

const SAMPLE = {
  title: 'Project Alpha sync',
  team: 'Engineering',
  text: `Meeting: Project Alpha weekly sync
Attendees: Rahul, Priya, Amit, Neha

We decided to use PostgreSQL for the main database.
Amit will write the API specification by Wednesday.
Rahul will finish the authentication module by Friday, once Amit's API spec is done.
Priya said the database migration may cause downtime over the weekend. Neha suggested running it in a maintenance window.
Neha to set up the staging environment next Monday.
Someone needs to update the onboarding docs at some point.
Priya is concerned the vendor contract renewal is still blocked on legal.`,
}

const TABS = [
  { id: 'text', label: 'Paste text' },
  { id: 'pdf', label: 'PDF', accept: '.pdf', hint: 'Meeting minutes or scanned notes (scans: up to 10 pages)' },
  { id: 'image', label: 'Handwritten / image', accept: '.png,.jpg,.jpeg', hint: 'Photo of handwritten notes or a whiteboard (PNG/JPG)' },
  { id: 'audio', label: 'Audio', accept: '.mp3,.wav,.m4a,.mp4,.ogg,.opus,.webm,.flac,.aac', hint: 'Meeting recording, up to 2 hours. Speakers are labelled automatically.' },
]

const BUSY = { pdf: 'Reading PDF...', image: 'Reading handwriting...', audio: 'Transcribing, this can take a minute or two...' }

const field = 'w-full rounded-xl bg-panel px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-card'

/**
 * Props
 *   project     – the currently active project object { id, name, ... }
 *   onResult    – called with the saved meeting after a successful analysis
 *   onBack      – called when the user wants to go back to the project workspace
 */
export default function Analyze({ project, onResult, onBack }) {
  const [tab, setTab] = useState('text')
  const [form, setForm] = useState(() => ({
    title: '',
    team: '',
    meeting_date: new Date().toLocaleDateString('en-CA'),
    text: '',
    input_type: 'text',
  }))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [source, setSource] = useState('')
  const [translate, setTranslate] = useState(true)
  const [recording, setRecording] = useState(false)
  const recorder = useRef(null)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  const upload = async (file) => {
    if (!file) return
    setBusy(BUSY[tab])
    setError('')
    try {
      const { text, input_type } = await ingestFile(file, translate)
      setForm((f) => ({ ...f, text, input_type, title: f.title || file.name.replace(/\.[^.]+$/, '') }))
      setSource(file.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const toggleRecording = async () => {
    if (recording) {
      recorder.current.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks = []
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const ext = mr.mimeType.includes('mp4') ? 'm4a' : 'webm'
        upload(new File(chunks, `recording.${ext}`, { type: mr.mimeType }))
      }
      mr.start()
      recorder.current = mr
      setRecording(true)
    } catch {
      setError('Microphone access was blocked. Allow it in your browser, or upload a file instead.')
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy('Extracting decisions, actions and risks...')
    setError('')
    try {
      const result = await analyze({
        ...form,
        title: form.title || 'Untitled meeting',
        team: form.team || 'General',
        // project_id comes from the active project — user never types it
        project_id: project.id,
      })
      onResult(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const current = TABS.find((t) => t.id === tab)

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl rounded-sm bg-white px-4 pb-12 shadow-sm sm:px-6">
        {/* Nav */}
        <nav className="flex flex-wrap items-center gap-4 py-4">
          <span className="text-2xl font-extrabold tracking-tight">
            quorum<span className="text-slate-card">.</span>
          </span>
          <div className="ml-4 flex items-center gap-2 text-sm text-navy/60">
            <button onClick={onBack} className="hover:text-navy">
              {project.name}
            </button>
            <span>/</span>
            <span className="font-medium text-navy">Analyze meeting</span>
          </div>
        </nav>

        {/* Active project badge */}
        <div className="mb-6 flex items-center gap-3 rounded-2xl bg-panel px-5 py-3">
          <span className="grid size-8 place-items-center rounded-full bg-navy text-white">
            <Icon name="layers" className="size-4" />
          </span>
          <div>
            <p className="text-xs font-light text-navy/60">Saving to project</p>
            <p className="text-sm font-semibold">{project.name}</p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="ml-auto text-xs underline underline-offset-4 hover:text-slate-card"
          >
            Change project
          </button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-xl font-medium">Analyze a meeting</h2>
          <button
            type="button"
            onClick={() => {
              setTab('text')
              setSource('')
              setForm({ ...form, ...SAMPLE, input_type: 'text' })
            }}
            className="text-sm underline underline-offset-4 hover:text-slate-card"
          >
            Load sample notes
          </button>
        </div>

        <div role="tablist" className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => { setTab(t.id); setError('') }}
              className={`rounded-full px-4 py-2 text-sm ${tab === t.id ? 'bg-navy text-white' : 'bg-panel hover:bg-slate-card/30'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 grid gap-4">
          {tab !== 'text' && (
            <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed border-slate-card/50 p-5">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-medium text-white hover:bg-navy/90">
                <Icon name="upload" className="size-4" /> Choose file
                <input
                  type="file"
                  accept={current.accept}
                  className="sr-only"
                  disabled={!!busy}
                  onChange={(e) => { upload(e.target.files[0]); e.target.value = '' }}
                />
              </label>
              {tab === 'audio' && (
                <button
                  type="button"
                  onClick={toggleRecording}
                  disabled={!!busy && !recording}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium ${recording ? 'bg-rose-600 text-white' : 'bg-panel hover:bg-slate-card/30'}`}
                >
                  {recording ? <span className="size-2.5 animate-pulse rounded-full bg-white" /> : <Icon name="mic" className="size-4" />}
                  {recording ? 'Stop recording' : 'Record now'}
                </button>
              )}
              <span className="text-xs font-light">{current.hint}</span>
              {tab === 'audio' && (
                <label className="flex w-full items-center gap-2 text-xs">
                  <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} className="accent-navy" />
                  Translate to English (for Hindi and other Indian languages)
                </label>
              )}
            </div>
          )}

          {source && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Text extracted from <strong className="font-medium">{source}</strong>. OCR and transcription can make mistakes — check the text below before analyzing.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <input className={field} placeholder="Meeting title" value={form.title} onChange={set('title')} />
            <input className={field} placeholder="Team (optional)" value={form.team} onChange={set('team')} />
            <input className={field} type="date" aria-label="Meeting date" value={form.meeting_date} onChange={set('meeting_date')} />
          </div>

          {(tab === 'text' || form.text) && (
            <textarea
              className={`${field} min-h-56 resize-y font-light`}
              placeholder="Paste your meeting notes, transcript or minutes here..."
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value, input_type: source ? form.input_type : 'text' })}
              required
              minLength={10}
            />
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              disabled={!!busy || form.text.trim().length < 10}
              className="rounded-full bg-navy px-6 py-2.5 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
            >
              Analyze meeting
            </button>
            {busy && <span role="status" className="text-sm font-light">{busy}</span>}
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
