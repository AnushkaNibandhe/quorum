/**
 * DependencyHealth.jsx
 *
 * Lightweight summary widget for the Project Workspace overview.
 * Shows task counts + conflict counts from the backend health endpoint.
 * Includes a "View Dependency Graph" button.
 */

import { useEffect, useState } from 'react'
import { getDependencyHealth } from './api'
import Icon from './Icon'

export default function DependencyHealth({ projectId, onOpenGraph }) {
  const [health,  setHealth]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    setLoading(true)
    getDependencyHealth(projectId)
      .then(setHealth)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) {
    return (
      <div className="mt-6 rounded-2xl bg-panel p-5">
        <p className="text-sm font-light text-navy/50 animate-pulse">Loading dependency health…</p>
      </div>
    )
  }

  if (error || !health) {
    return null // silent fail — don't break the workspace page
  }

  const hasData = health.total > 0

  return (
    <div className="mt-6 rounded-2xl bg-panel p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Dependency Health</h3>
        {hasData && (
          <button
            onClick={onOpenGraph}
            className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-1.5 text-xs font-medium text-white hover:bg-navy/90"
          >
            <Icon name="graph" className="size-3.5" />
            View Graph
          </button>
        )}
      </div>

      {!hasData ? (
        <p className="mt-3 text-sm font-light text-navy/60">
          No dependencies detected yet. Analyze a meeting with explicitly ordered tasks to see the graph.
        </p>
      ) : (
        <>
          {/* Stat row */}
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              { label: 'Total',       value: health.total,                color: 'text-navy'          },
              { label: 'Done',        value: health.completed,            color: 'text-emerald-700'   },
              { label: 'In progress', value: health.in_progress,          color: 'text-amber-700'     },
              { label: 'Open',        value: health.open,                 color: 'text-navy/60'       },
              { label: 'Blocked',     value: health.blocked,              color: 'text-rose-700'      },
              { label: 'Conflicts',   value: health.schedule_conflicts + health.circular_dependencies, color: health.schedule_conflicts + health.circular_dependencies > 0 ? 'text-rose-700' : 'text-navy/60' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col items-center rounded-xl bg-white p-2 text-center">
                <span className={`text-xl font-semibold ${color}`}>{value}</span>
                <span className="mt-0.5 text-[10px] font-light text-navy/50 leading-tight">{label}</span>
              </div>
            ))}
          </div>

          {/* Conflict warnings */}
          {(health.schedule_conflicts > 0 || health.circular_dependencies > 0) && (
            <div className="mt-3 flex flex-col gap-1.5">
              {health.schedule_conflicts > 0 && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <span>⚠</span>
                  <span>
                    <strong>{health.schedule_conflicts}</strong> schedule conflict{health.schedule_conflicts !== 1 ? 's' : ''} — a task is due before its dependency.
                  </span>
                </div>
              )}
              {health.circular_dependencies > 0 && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <span>🔄</span>
                  <span>
                    <strong>{health.circular_dependencies}</strong> circular dependency{health.circular_dependencies !== 1 ? 'ies' : 'y'} detected — check the graph.
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
