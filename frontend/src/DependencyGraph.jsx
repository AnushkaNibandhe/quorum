/**
 * DependencyGraph.jsx
 *
 * Interactive React Flow canvas showing project action-item dependencies.
 * Matches Quorum's existing visual identity (navy / slate-card / panel / mist palette).
 *
 * Props
 * ─────
 *   projectId   – number
 *   projectName – string
 *   onBack      – () => void  (back to project workspace)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { getDependencyGraph } from './api'
import Icon from './Icon'

// ---------------------------------------------------------------------------
// Colour helpers matching Quorum palette
// ---------------------------------------------------------------------------

const STATUS_STYLE = {
  done:        { border: '#22c55e', bg: '#f0fdf4', badge: 'bg-emerald-100 text-emerald-800' },
  in_progress: { border: '#f59e0b', bg: '#fffbeb', badge: 'bg-amber-100 text-amber-800'   },
  blocked:     { border: '#ef4444', bg: '#fff1f2', badge: 'bg-rose-100 text-rose-800'     },
  open:        { border: '#8e9db5', bg: '#eceef2', badge: 'bg-slate-100 text-slate-700'   },
}
const DEFAULT_STYLE = STATUS_STYLE.open

const PRIORITY_DOT = {
  HIGH:   'bg-rose-500',
  MEDIUM: 'bg-amber-400',
  LOW:    'bg-slate-400',
}

function statusStyle(node) {
  if (node.data.is_blocked && node.data.status !== 'done') return STATUS_STYLE.blocked
  return STATUS_STYLE[node.data.status] ?? DEFAULT_STYLE
}

// ---------------------------------------------------------------------------
// Custom React Flow node
// ---------------------------------------------------------------------------

function ActionNodeCard({ data, selected }) {
  const s = STATUS_STYLE[data.is_blocked && data.status !== 'done' ? 'blocked' : data.status] ?? DEFAULT_STYLE
  const statusLabel = data.is_blocked && data.status !== 'done'
    ? 'Blocked'
    : { done: 'Done', in_progress: 'In progress', open: 'Open', blocked: 'Blocked' }[data.status] ?? data.status

  return (
    <div
      style={{
        border: `2px solid ${selected ? '#26354f' : s.border}`,
        background: s.bg,
        boxShadow: selected ? '0 0 0 3px #26354f40' : '0 2px 8px rgba(0,0,0,.10)',
      }}
      className="w-52 rounded-2xl p-3 cursor-pointer transition-shadow"
    >
      {/* Top: ID + priority dot */}
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] font-mono font-semibold text-navy/50">{data.id}</span>
        <span className={`size-2 rounded-full ${PRIORITY_DOT[data.priority] ?? 'bg-slate-400'}`} title={`${data.priority} priority`} />
      </div>

      {/* Task title */}
      <p className="text-xs font-semibold text-navy leading-snug line-clamp-3">{data.task}</p>

      {/* Owner */}
      {data.owner && (
        <p className="mt-1.5 text-[10px] text-navy/60 truncate">👤 {data.owner}</p>
      )}

      {/* Due date */}
      {data.due_date && (
        <p className="text-[10px] text-navy/60">📅 {data.due_date}</p>
      )}

      {/* Status badge */}
      <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${s.badge}`}>
        {statusLabel}
      </span>

      {/* Conflict indicator */}
      {data.has_conflict && (
        <span className="ml-1 inline-block rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-medium text-white">
          ⚠ Conflict
        </span>
      )}

      {/* React Flow handles */}
      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = { action: ActionNodeCard }

// ---------------------------------------------------------------------------
// Auto-layout: simple top-down layered layout (no external lib needed)
// ---------------------------------------------------------------------------

function layoutNodes(rfNodes, rfEdges) {
  if (!rfNodes.length) return rfNodes

  // Build adjacency for BFS layering
  const outEdges = {}
  const inDegree = {}
  rfNodes.forEach((n) => { outEdges[n.id] = []; inDegree[n.id] = 0 })
  rfEdges.forEach((e) => {
    outEdges[e.source]?.push(e.target)
    inDegree[e.target] = (inDegree[e.target] ?? 0) + 1
  })

  // Kahn's topological sort → assign layers
  const layer = {}
  const queue = rfNodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id)
  queue.forEach((id) => { layer[id] = 0 })

  let qi = 0
  while (qi < queue.length) {
    const cur = queue[qi++]
    for (const nxt of (outEdges[cur] ?? [])) {
      layer[nxt] = Math.max(layer[nxt] ?? 0, (layer[cur] ?? 0) + 1)
      inDegree[nxt]--
      if (inDegree[nxt] === 0) queue.push(nxt)
    }
  }

  // Nodes not reached (cycles) get their own layer
  rfNodes.forEach((n) => { if (layer[n.id] === undefined) layer[n.id] = 0 })

  // Group by layer, spread horizontally
  const byLayer = {}
  rfNodes.forEach((n) => {
    const l = layer[n.id] ?? 0
    ;(byLayer[l] = byLayer[l] ?? []).push(n.id)
  })

  const NODE_W = 224, NODE_H = 130, GAP_X = 40, GAP_Y = 80
  const positioned = { ...Object.fromEntries(rfNodes.map((n) => [n.id, n])) }

  Object.entries(byLayer).forEach(([l, ids]) => {
    const totalW = ids.length * NODE_W + (ids.length - 1) * GAP_X
    ids.forEach((id, i) => {
      positioned[id] = {
        ...positioned[id],
        position: {
          x: i * (NODE_W + GAP_X) - totalW / 2,
          y: Number(l) * (NODE_H + GAP_Y),
        },
      }
    })
  })

  return Object.values(positioned)
}

// ---------------------------------------------------------------------------
// Detail side panel
// ---------------------------------------------------------------------------

function DetailPanel({ node, graphData, onClose }) {
  if (!node) return null
  const d = node.data

  const conflictsForNode = graphData.conflicts.filter(
    (c) => c.source_action_id === node.id || c.target_action_id === node.id
  )

  return (
    <div className="absolute right-4 top-4 z-10 w-72 rounded-[20px] bg-white shadow-xl border border-panel overflow-y-auto max-h-[90%]">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-panel">
        <span className="text-xs font-mono font-semibold text-navy/40">{node.id}</span>
        <button onClick={onClose} className="grid size-7 place-items-center rounded-full hover:bg-panel">
          <Icon name="x" className="size-4" />
        </button>
      </div>

      <div className="px-5 py-4 space-y-3 text-sm">
        <p className="font-semibold text-navy leading-snug">{d.task}</p>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="font-medium text-navy/50 mb-0.5">Owner</p>
            <p>{d.owner ?? <span className="text-navy/30">Unassigned</span>}</p>
          </div>
          <div>
            <p className="font-medium text-navy/50 mb-0.5">Due</p>
            <p>{d.due_date ?? <span className="text-navy/30">No date</span>}</p>
          </div>
          <div>
            <p className="font-medium text-navy/50 mb-0.5">Priority</p>
            <p>{d.priority}</p>
          </div>
          <div>
            <p className="font-medium text-navy/50 mb-0.5">Status</p>
            <p>{d.is_blocked && d.status !== 'done' ? '🔴 Blocked' : d.status}</p>
          </div>
        </div>

        {d.meeting_title && (
          <div className="text-xs">
            <p className="font-medium text-navy/50 mb-0.5">Source meeting</p>
            <p className="text-navy/70">{d.meeting_title}</p>
          </div>
        )}

        {d.depends_on?.length > 0 && (
          <div className="text-xs">
            <p className="font-medium text-navy/50 mb-1">Depends on</p>
            {d.depends_on.map((depId) => {
              const depNode = graphData.nodes.find((n) => n.id === depId)
              return (
                <div key={depId} className="flex items-start gap-1.5 mb-1">
                  <span className="text-slate-card mt-0.5">→</span>
                  <span>
                    <span className="font-mono text-[10px] text-navy/40">{depId} </span>
                    {depNode?.data.task ?? depId}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {d.dependents?.length > 0 && (
          <div className="text-xs">
            <p className="font-medium text-navy/50 mb-1">Blocks</p>
            {d.dependents.map((depId) => {
              const depNode = graphData.nodes.find((n) => n.id === depId)
              return (
                <div key={depId} className="flex items-start gap-1.5 mb-1">
                  <span className="text-slate-card mt-0.5">→</span>
                  <span>
                    <span className="font-mono text-[10px] text-navy/40">{depId} </span>
                    {depNode?.data.task ?? depId}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {d.blocked_by?.length > 0 && (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <p className="font-medium mb-1">Blocked by</p>
            {d.blocked_by.map((id) => <p key={id} className="font-mono">{id}</p>)}
          </div>
        )}

        {conflictsForNode.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-navy/50">Conflicts</p>
            {conflictsForNode.map((c, i) => (
              <div key={i} className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <p className="font-medium">{c.type.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 font-light">{c.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conflict banner strip
// ---------------------------------------------------------------------------

function ConflictBanner({ conflicts }) {
  if (!conflicts.length) return null
  return (
    <div className="absolute left-4 bottom-4 z-10 flex flex-col gap-2 max-w-sm">
      {conflicts.map((c, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800 shadow-sm">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span><strong>{c.type.replace(/_/g, ' ')}</strong> — {c.message}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function DependencyGraphInner({ projectId, projectName, onBack }) {
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [selectedNode, setSelectedNode] = useState(null)

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([])

  // Build RF nodes + edges when graph data arrives
  useEffect(() => {
    setLoading(true)
    getDependencyGraph(projectId)
      .then((data) => {
        setGraphData(data)

        // Which node IDs have conflicts
        const conflictIds = new Set(
          data.conflicts.flatMap((c) => [c.source_action_id, c.target_action_id].filter(Boolean))
        )

        const nodes = data.nodes.map((n) => ({
          id: n.id,
          type: 'action',
          position: { x: 0, y: 0 }, // layoutNodes will set real positions
          data: {
            id: n.id,
            ...n.data,
            has_conflict: conflictIds.has(n.id),
          },
        }))

        const edges = data.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#26354f' },
          style: { stroke: '#26354f', strokeWidth: 1.5 },
          label: e.dependency_type === 'BLOCKING' ? '' : e.dependency_type,
        }))

        const laid = layoutNodes(nodes, edges)
        setRfNodes(laid)
        setRfEdges(edges)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId])

  const onNodeClick = useCallback((_, node) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node))
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  // ── Empty / loading states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm font-light text-navy/50 animate-pulse">Loading dependency graph…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="rounded-2xl bg-rose-50 px-6 py-4 text-sm text-rose-800">{error}</p>
      </div>
    )
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-panel">
          <Icon name="layers" className="size-8 text-slate-card" />
        </span>
        <p className="text-sm font-light text-navy/60">No dependencies detected yet.</p>
        <p className="max-w-xs text-xs font-light text-navy/40">
          Analyze a meeting with action items that have explicit ordering relationships to see the graph.
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#b9cbd1" gap={20} size={1} />
        <Controls showInteractive={false} className="!shadow-none !border-panel" />
        <MiniMap
          nodeColor={(n) => {
            const s = STATUS_STYLE[
              n.data?.is_blocked && n.data?.status !== 'done' ? 'blocked' : n.data?.status
            ] ?? DEFAULT_STYLE
            return s.border
          }}
          maskColor="rgba(38,53,79,0.06)"
          className="!rounded-xl !border-panel"
        />
      </ReactFlow>

      <ConflictBanner conflicts={graphData.conflicts} />

      <DetailPanel
        node={selectedNode}
        graphData={graphData}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page wrapper — full-screen canvas with nav bar
// ---------------------------------------------------------------------------

export default function DependencyGraph({ projectId, projectName, onBack }) {
  return (
    <div className="flex h-screen flex-col bg-mist">
      {/* Nav */}
      <nav className="flex shrink-0 flex-wrap items-center gap-4 bg-white px-6 py-3 shadow-sm">
        <span className="text-xl font-extrabold tracking-tight">
          quorum<span className="text-slate-card">.</span>
        </span>
        <div className="ml-4 flex items-center gap-2 text-sm text-navy/60">
          <button onClick={onBack} className="hover:text-navy">{projectName}</button>
          <span>/</span>
          <span className="font-medium text-navy">Dependency Graph</span>
        </div>
        <button
          onClick={onBack}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-panel px-4 py-2 text-sm font-medium hover:bg-slate-card/30"
        >
          <Icon name="chevron-left" className="size-4" /> Back
        </button>
      </nav>

      {/* Graph canvas */}
      <div className="flex-1 overflow-hidden">
        <ReactFlowProvider>
          <DependencyGraphInner
            projectId={projectId}
            projectName={projectName}
            onBack={onBack}
          />
        </ReactFlowProvider>
      </div>
    </div>
  )
}
