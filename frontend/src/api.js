// ---------------------------------------------------------------------------
// Token storage  —  persisted in localStorage for session continuity
// ---------------------------------------------------------------------------

export const token = {
  get: () => localStorage.getItem('quorum_token'),
  set: (t) => localStorage.setItem('quorum_token', t),
  clear: () => localStorage.removeItem('quorum_token'),
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }

  const t = token.get()
  if (t) headers['Authorization'] = `Bearer ${t}`

  // Don't set Content-Type for FormData — browser sets it with boundary
  const res = await fetch(`/api${path}`, { ...options, headers })
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}))

  if (!res.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => d.msg).join(', ')
      : body.detail
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return body
}

const json = (method, payload) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const signUp = (name, email, password) =>
  request('/auth/signup', json('POST', { name, email, password }))

export const signIn = (email, password) =>
  request('/auth/signin', json('POST', { email, password }))

export const getMe = () => request('/auth/me')

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const listProjects = () => request('/projects')

export const createProject = (name, description = '') =>
  request('/projects', json('POST', { name, description }))

export const getProject = (id) => request(`/projects/${id}`)

export const deleteProject = (id) =>
  request(`/projects/${id}`, { method: 'DELETE' })

export const listProjectMembers = (projectId) =>
  request(`/projects/${projectId}/members`)

export const addProjectMember = (projectId, email, role = 'MEMBER') =>
  request(`/projects/${projectId}/members`, json('POST', { email, role }))

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export const listInvitations = () => request('/invitations')

export const acceptInvitation = (projectId) =>
  request(`/invitations/${projectId}/accept`, { method: 'POST' })

export const rejectInvitation = (projectId) =>
  request(`/invitations/${projectId}/reject`, { method: 'POST' })

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const getMyTasks = () => request('/tasks/mine')

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

export const getDependencyGraph  = (projectId) => request(`/projects/${projectId}/dependency-graph`)
export const getDependencyHealth = (projectId) => request(`/projects/${projectId}/dependency-health`)

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const listMeetings = () => request('/meetings')

export const listProjectMeetings = (projectId) =>
  request(`/projects/${projectId}/meetings`)

export const getMeeting = (id) => request(`/meetings/${id}`)

export const saveReview = (id, result) =>
  request(`/meetings/${id}/result`, json('PUT', result))

export const deleteMeeting = (id) =>
  request(`/meetings/${id}`, { method: 'DELETE' })

// ---------------------------------------------------------------------------
// Analysis  (project_id required; team optional)
// ---------------------------------------------------------------------------

export const analyze = (payload) => request('/analyze', json('POST', payload))

// ---------------------------------------------------------------------------
// File ingest  (Sarvam OCR / transcription pipeline)
// ---------------------------------------------------------------------------

export function ingestFile(file, translate) {
  const form = new FormData()
  form.append('file', file)
  form.append('translate', translate)
  return request('/ingest', { method: 'POST', body: form })
}
