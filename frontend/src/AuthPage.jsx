import { useState } from 'react'
import { signIn, signUp, token } from './api'

const field =
  'w-full rounded-xl bg-panel px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-card placeholder:text-navy/40'

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res =
        mode === 'signup'
          ? await signUp(name, email, password)
          : await signIn(email, password)
      token.set(res.access_token)
      onAuth({ id: res.user_id, name: res.name, email: res.email })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[28px] bg-white px-8 py-10 shadow-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="text-3xl font-extrabold tracking-tight">
            quorum<span className="text-slate-card">.</span>
          </span>
          <p className="mt-1 text-sm font-light text-navy/60">
            AI Meeting Intelligence
          </p>
        </div>

        {/* Mode toggle */}
        <div className="mb-6 flex rounded-full bg-panel p-1">
          {['signin', 'signup'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError('') }}
              className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                mode === m ? 'bg-navy text-white' : 'text-navy/60 hover:text-navy'
              }`}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'signup' && (
            <input
              className={field}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          )}
          <input
            className={field}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={mode === 'signin'}
          />
          <input
            className={field}
            type="password"
            placeholder={mode === 'signup' ? 'Password (min 6 chars)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 6 : 1}
          />

          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </p>
          )}

          <button
            disabled={busy}
            className="mt-2 rounded-full bg-navy py-3 text-sm font-medium text-white hover:bg-navy/90 disabled:opacity-50"
          >
            {busy
              ? mode === 'signup'
                ? 'Creating account...'
                : 'Signing in...'
              : mode === 'signup'
              ? 'Create account'
              : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-navy/50">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}
            className="font-medium text-navy underline underline-offset-2"
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
