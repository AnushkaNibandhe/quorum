import { useEffect, useRef, useState } from 'react'
import { deleteMeeting, saveReview } from './api'
import Icon from './Icon'

const LEVEL = { HIGH: 'bg-rose-100 text-rose-800', MEDIUM: 'bg-amber-100 text-amber-800', LOW: 'bg-slate-100 text-slate-700' }
const STATUS = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }
const KINDS = ['decisions', 'action_items', 'risks']

// Borderless inputs that read like text until focused.
const edit = 'w-full rounded-md bg-transparent px-1 py-0.5 outline-none hover:bg-panel focus:bg-white focus:ring-2 focus:ring-slate-card'

function confidenceLabel(c) {
  if (c >= 0.9) return ['High', 'bg-emerald-500']
  if (c >= 0.7) return ['Medium', 'bg-amber-500']
  return ['Needs review', 'bg-rose-500']
}

function Confidence({ value }) {
  const [label, color] = confidenceLabel(value)
  return (
    <div className="min-w-24" title="Extraction confidence: how clearly the notes state this item. Not a calibrated probability.">
      <div className="h-1.5 rounded-full bg-panel"><div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value * 100}%` }} /></div>
      <span className="text-[11px] font-light">{Math.round(value * 100)}% · {label}</span>
    </div>
  )
}

function EvidenceButton({ item, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${active ? 'bg-navy text-white' : 'bg-panel hover:bg-slate-card/30'}`}
    >
      <Icon name={item.evidence_found ? 'quote' : 'alert'} className="size-3.5" />
      {item.evidence_found ? 'View source' : 'Unverified'}
    </button>
  )
}

function ReviewButtons({ value, onChange }) {
  const btn = (target, icon, on, label) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={value === target}
      onClick={() => onChange(value === target ? 'pending' : target)}
      className={`grid size-7 place-items-center rounded-full ${value === target ? on : 'bg-panel text-navy hover:bg-slate-card/30'}`}
    >
      <Icon name={icon} className="size-4" />
    </button>
  )
  return (
    <div className="flex shrink-0 gap-1">
      {btn('approved', 'tick', 'bg-emerald-600 text-white', 'Approve')}
      {btn('rejected', 'x', 'bg-rose-600 text-white', 'Reject')}
    </div>
  )
}

function highlight(text, quote) {
  const clean = quote?.trim().replace(/^["'“”]+|["'“”.\s]+$/g, '')
  const i = clean ? text.toLowerCase().indexOf(clean.toLowerCase()) : -1
  if (i < 0) return text
  return [text.slice(0, i), <mark key="m" className="rounded bg-amber-200 px-0.5 text-navy">{text.slice(i, i + clean.length)}</mark>, text.slice(i + clean.length)]
}

export default function Results({ meeting, onSaved, onDeleted }) {
  const [draft, setDraft] = useState(meeting.result)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // "kind:index"
  const sourceRef = useRef(null)

  useEffect(() => { sourceRef.current?.querySelector('mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [selected])

  const update = (kind, i, patch) => {
    setDraft((d) => ({ ...d, [kind]: d[kind].map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
    setDirty(true)
  }
  const evidenceProps = (kind, i, item) => ({
    item, active: selected === `${kind}:${i}`, onClick: () => setSelected(selected === `${kind}:${i}` ? null : `${kind}:${i}`),
  })
  const [selKind, selIndex] = selected ? selected.split(':') : []
  const selectedItem = selected && draft[selKind][+selIndex]
  const dim = (item) => (item.review === 'rejected' ? 'opacity-45' : '')

  const pending = KINDS.flatMap((k) => draft[k]).filter((x) => x.review === 'pending').length
  const approveConfident = () => {
    const approve = (x) => (x.review === 'pending' && x.evidence_found && x.confidence >= 0.9 ? { ...x, review: 'approved' } : x)
    setDraft((d) => ({ ...d, decisions: d.decisions.map(approve), action_items: d.action_items.map(approve), risks: d.risks.map(approve) }))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const saved = await saveReview(meeting.id, draft)
      setDraft(saved.result) // server re-checks evidence, so take its copy
      setDirty(false)
      onSaved(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!confirm(`Delete "${meeting.title}"? This can't be undone.`)) return
    try {
      await deleteMeeting(meeting.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section id="results" className="mt-16 scroll-mt-6 px-2 sm:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-medium">{meeting.title}</h2>
        <span className="rounded-full bg-panel px-3 py-1 text-xs capitalize">Tone: {draft.tone}</span>
        <span className="rounded-full bg-panel px-3 py-1 text-xs">From {meeting.input_type === 'text' ? 'text' : meeting.input_type.toUpperCase()}</span>
        <button onClick={remove} className="ml-auto inline-flex items-center gap-1 text-xs text-rose-700 hover:underline">
          <Icon name="trash" className="size-4" /> Delete meeting
        </button>
      </div>
      <p className="mt-1 text-sm font-light">{meeting.project} · {meeting.team} · {meeting.meeting_date}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
        <p className="rounded-2xl bg-panel p-5 text-sm leading-relaxed">{draft.summary}</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[['Decisions', draft.decisions.length], ['Actions', draft.action_items.length], ['Risks', draft.risks.length], ['To review', pending]].map(([label, n]) => (
            <div key={label} className="grid min-w-20 content-center rounded-2xl bg-navy p-3 text-white">
              <span className="text-2xl font-semibold">{n}</span>
              <span className="text-[11px] text-white/80">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-panel p-3 text-sm">
        <span className="font-light">Approve or reject each item, and click any text to fix what the AI got wrong.</span>
        <button onClick={approveConfident} disabled={!pending} className="ml-auto rounded-full bg-panel px-4 py-1.5 text-xs font-medium hover:bg-slate-card/30 disabled:opacity-50">
          Approve all verified ≥90%
        </button>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-8">
          {/* Actions */}
          <div>
            <h3 className="font-medium">Action items</h3>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-panel">
              <table className="w-full min-w-220 text-left text-sm">
                <thead className="bg-panel text-xs">
                  <tr>{['Review', 'Task', 'Owner', 'Due', 'Priority', 'Status', 'Confidence', ''].map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {draft.action_items.map((a, i) => (
                    <tr key={a.id} className={`border-t border-panel align-top ${dim(a)}`}>
                      <td className="px-3 py-3"><ReviewButtons value={a.review} onChange={(review) => update('action_items', i, { review })} /></td>
                      <td className="min-w-56 px-2 py-2.5">
                        <div className="flex items-start gap-1">
                          <span className="pt-1 text-xs text-slate-card">{a.id}</span>
                          <textarea rows={2} aria-label="Task" className={`${edit} resize-none`} value={a.task} onChange={(e) => update('action_items', i, { task: e.target.value })} />
                        </div>
                        {a.depends_on.length > 0 && <div className="mt-1 pl-6 text-[11px] font-light">After {a.depends_on.join(', ')}</div>}
                      </td>
                      <td className="px-2 py-2.5">
                        <input
                          aria-label="Owner"
                          className={`${edit} placeholder:text-rose-700`}
                          placeholder="Unassigned"
                          value={a.owner ?? ''}
                          onChange={(e) => update('action_items', i, { owner: e.target.value || null })}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <input type="date" aria-label="Due date" className={`${edit} ${a.due_date ? '' : 'text-rose-700'}`} value={a.due_date ?? ''} onChange={(e) => update('action_items', i, { due_date: e.target.value || null })} />
                        {a.due_text && <div className="px-1 text-[11px] font-light">"{a.due_text}"</div>}
                      </td>
                      <td className="px-2 py-2.5">
                        <select aria-label="Priority" className={`rounded-full px-2 py-0.5 text-[11px] font-medium outline-none ${LEVEL[a.priority]}`} value={a.priority} onChange={(e) => update('action_items', i, { priority: e.target.value })}>
                          {Object.keys(LEVEL).map((p) => <option key={p}>{p}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2.5">
                        <select aria-label="Status" className="rounded-full bg-panel px-2 py-0.5 text-[11px] outline-none" value={a.status} onChange={(e) => update('action_items', i, { status: e.target.value })}>
                          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3"><Confidence value={a.confidence} /></td>
                      <td className="px-3 py-3"><EvidenceButton {...evidenceProps('action_items', i, a)} /></td>
                    </tr>
                  ))}
                  {draft.action_items.length === 0 && <tr><td colSpan={8} className="px-3 py-4 font-light">No action items found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Decisions */}
          <div>
            <h3 className="font-medium">Decisions</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {draft.decisions.map((d, i) => (
                <div key={i} className={`flex flex-col gap-3 rounded-2xl bg-panel p-4 ${dim(d)}`}>
                  <div className="flex items-start gap-2">
                    <textarea rows={2} aria-label="Decision" className={`${edit} resize-none font-medium hover:bg-white`} value={d.decision} onChange={(e) => update('decisions', i, { decision: e.target.value })} />
                    <ReviewButtons value={d.review} onChange={(review) => update('decisions', i, { review })} />
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3"><Confidence value={d.confidence} /><EvidenceButton {...evidenceProps('decisions', i, d)} /></div>
                </div>
              ))}
              {draft.decisions.length === 0 && <p className="text-sm font-light">No decisions found.</p>}
            </div>
          </div>

          {/* Risks */}
          <div>
            <h3 className="font-medium">Risks</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {draft.risks.map((k, i) => (
                <div key={i} className={`flex flex-col gap-2 rounded-2xl bg-slate-card p-4 text-white ${dim(k)}`}>
                  <div className="flex items-start gap-2">
                    <textarea rows={2} aria-label="Risk" className={`${edit} resize-none font-medium hover:bg-white/10 focus:text-navy`} value={k.risk} onChange={(e) => update('risks', i, { risk: e.target.value })} />
                    <select aria-label="Severity" className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium outline-none ${LEVEL[k.severity]}`} value={k.severity} onChange={(e) => update('risks', i, { severity: e.target.value })}>
                      {Object.keys(LEVEL).map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  {k.mitigation && <p className="px-1 text-xs font-light">Mitigation: {k.mitigation}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-2 text-navy">
                    <Confidence value={k.confidence} />
                    <div className="flex items-center gap-2"><EvidenceButton {...evidenceProps('risks', i, k)} /><ReviewButtons value={k.review} onChange={(review) => update('risks', i, { review })} /></div>
                  </div>
                </div>
              ))}
              {draft.risks.length === 0 && <p className="text-sm font-light">No risks found.</p>}
            </div>
          </div>
        </div>

        {/* Source */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <h3 className="font-medium">Source notes</h3>
          {selectedItem && !selectedItem.evidence_found && (
            <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">
              The AI's quote, "{selectedItem.evidence || 'none given'}", doesn't appear word for word in the notes. Check this item before acting on it.
            </p>
          )}
          <div ref={sourceRef} className="mt-3 max-h-[480px] overflow-y-auto rounded-2xl bg-panel p-4 text-sm leading-relaxed font-light whitespace-pre-wrap">
            {selectedItem ? highlight(meeting.raw_text, selectedItem.evidence) : meeting.raw_text}
          </div>
          <p className="mt-2 text-[11px] font-light">Click "View source" on any item to see the line it came from.</p>
        </aside>
      </div>

      {(dirty || error) && (
        <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-navy px-5 py-3 text-sm text-white shadow-lg">
          <span>{error || 'You have unsaved review changes.'}</span>
          <button onClick={() => { setDraft(meeting.result); setDirty(false); setError('') }} className="ml-auto rounded-full px-4 py-1.5 hover:bg-white/10">Discard</button>
          <button onClick={save} disabled={saving || !dirty} className="rounded-full bg-white px-5 py-1.5 font-medium text-navy disabled:opacity-60">{saving ? 'Saving...' : 'Save review'}</button>
        </div>
      )}
    </section>
  )
}
