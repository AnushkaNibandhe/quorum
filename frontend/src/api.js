async function request(path, options) {
  const res = await fetch(`/api${path}`, options)
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join(', ') : body.detail
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return body
}

const json = (method, payload) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

export const analyze = (payload) => request('/analyze', json('POST', payload))
export const listMeetings = () => request('/meetings')
export const getMeeting = (id) => request(`/meetings/${id}`)
export const saveReview = (id, result) => request(`/meetings/${id}/result`, json('PUT', result))
export const deleteMeeting = (id) => request(`/meetings/${id}`, { method: 'DELETE' })

export function ingestFile(file, translate) {
  const form = new FormData()
  form.append('file', file)
  form.append('translate', translate)
  return request('/ingest', { method: 'POST', body: form })
}
