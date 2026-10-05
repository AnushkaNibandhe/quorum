import { useRef, useState } from 'react'
import { analyze, ingestFile } from './api'
import Icon from './Icon'

const SAMPLE = {
  title: 'Project Alpha sync',
  project: 'Project Alpha',
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

export default function Analyze({ meetings, onResult }) {
  const [tab, setTab] = useState('text')
  const [form, setForm] = useState(() => ({ title: '', project: '', team: '', meeting_date: new Date().toLocaleDateString('en-CA'), text: '', input_type: 'text' }))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [source, setSource] = useState('') // name of the file the text came from
  const [translate, setTranslate] = useState(true)
  const [recording, setRecording] = useState(false)
  const recorder = useRef(null)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const unique = (key) => [...new Set(meetings.map((m) => m[key]))]

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
      onResult(await analyze({
        ...form,
        title: form.title || 'Untitled meeting',
        project: form.project || 'General',
        team: form.team || 'General',
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const current = TABS.find((t) => t.id === tab)

  return (
    <section id="analyze" className="scroll-mt-6 px-2 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-xl font-medium">Analyze a meeting</h2>
        <button type="button" onClick={() => { setTab('text'); setSource(''); setForm({ ...form, ...SAMPLE, input_type: 'text' }) }} className="text-sm underline underline-offset-4 hover:text-slate-card">
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
              <input type="file" accept={current.accept} className="sr-only" disabled={!!busy} onChange={(e) => { upload(e.target.files[0]); e.target.value = '' }} />
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
            Text extracted from <strong className="font-medium">{source}</strong>. OCR and transcription can make mistakes, so check and fix the text below before analyzing.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <input className={field} placeholder="Meeting title" value={form.title} onChange={set('title')} />
          <input className={field} placeholder="Project" list="projects" value={form.project} onChange={set('project')} />
          <input className={field} placeholder="Team" list="teams" value={form.team} onChange={set('team')} />
          <input className={field} type="date" aria-label="Meeting date" value={form.meeting_date} onChange={set('meeting_date')} />
          <datalist id="projects">{unique('project').map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="teams">{unique('team').map((t) => <option key={t} value={t} />)}</datalist>
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
          <button disabled={!!busy || form.text.trim().length < 10} className="rounded-full bg-navy px-6 py-2.5 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50">
            Analyze meeting
          </button>
          {busy && <span role="status" className="text-sm font-light">{busy}</span>}
        </div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      </form>
    </section>
  )
}
