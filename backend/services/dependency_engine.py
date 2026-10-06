"""
Dependency Engine
=================
Pure-Python, deterministic graph analysis.  No LLM, no embeddings.

Responsibilities
----------------
1. Accept a flat list of ActionNode inputs (from DB or in-memory).
2. Validate dependency references (no dangling IDs).
3. Build a directed graph (adjacency map).
4. Detect circular dependencies via DFS.
5. Detect deadline (schedule) conflicts.
6. Determine blocked tasks.
7. Return a GraphResult ready for the API response.

Separation of concerns
-----------------------
- The engine knows nothing about SQLModel, FastAPI, or Sarvam.
- main.py / the API layer feeds it data and saves results.
- Tests can call it directly without a database.

Edge semantics
--------------
  source_action_id → target_action_id
means "target DEPENDS ON source" (source must finish first).

  A1 → A2  means A2 depends on A1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


# ---------------------------------------------------------------------------
# Input / output data classes  (no Pydantic — engine stays framework-free)
# ---------------------------------------------------------------------------

@dataclass
class ActionNode:
    """One action item fed into the engine."""
    id: str                          # e.g. "A1"
    task: str
    owner: Optional[str]
    due_date: Optional[date]
    priority: str                    # HIGH | MEDIUM | LOW
    status: str                      # open | in_progress | blocked | done
    depends_on: list[str]            # IDs that must complete first
    dependency_type: str = "BLOCKING"
    meeting_id: Optional[int] = None
    meeting_title: Optional[str] = None


@dataclass
class Conflict:
    type: str           # CIRCULAR_DEPENDENCY | SCHEDULE_CONFLICT | INVALID_REFERENCE
    severity: str       # high | medium | low
    message: str
    source_action_id: Optional[str] = None
    target_action_id: Optional[str] = None
    cycle: list[str] = field(default_factory=list)


@dataclass
class GraphNode:
    id: str
    type: str = "action"
    # enriched data
    task: str = ""
    owner: Optional[str] = None
    due_date: Optional[date] = None
    priority: str = "MEDIUM"
    status: str = "open"
    is_blocked: bool = False
    blocked_by: list[str] = field(default_factory=list)
    meeting_id: Optional[int] = None
    meeting_title: Optional[str] = None
    depends_on: list[str] = field(default_factory=list)
    dependents: list[str] = field(default_factory=list)  # tasks that depend on this one


@dataclass
class GraphEdge:
    id: str           # "A1-A2"
    source: str       # source_action_id (must finish first)
    target: str       # target_action_id (depends on source)
    type: str = "dependency"
    dependency_type: str = "BLOCKING"


@dataclass
class GraphResult:
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    conflicts: list[Conflict]
    health: "DependencyHealth"


@dataclass
class DependencyHealth:
    total: int = 0
    completed: int = 0
    in_progress: int = 0
    open: int = 0
    blocked: int = 0
    schedule_conflicts: int = 0
    circular_dependencies: int = 0


# ---------------------------------------------------------------------------
# Main engine function
# ---------------------------------------------------------------------------

def analyse(actions: list[ActionNode]) -> GraphResult:
    """
    Run the full dependency analysis pipeline on a list of ActionNode objects.
    Returns a GraphResult with nodes, edges, conflicts, and a health summary.
    """
    if not actions:
        return GraphResult(nodes=[], edges=[], conflicts=[], health=DependencyHealth())

    id_map: dict[str, ActionNode] = {a.id: a for a in actions}

    conflicts: list[Conflict] = []
    edges: list[GraphEdge] = []

    # ── 1. Validate references ─────────────────────────────────────────────
    for action in actions:
        for dep_id in action.depends_on:
            if dep_id not in id_map:
                conflicts.append(Conflict(
                    type="INVALID_REFERENCE",
                    severity="medium",
                    source_action_id=dep_id,
                    target_action_id=action.id,
                    message=(
                        f"Action {action.id} references dependency '{dep_id}' "
                        f"which does not exist in this project."
                    ),
                ))

    # Build adjacency: for each target, list its valid source deps
    valid_deps: dict[str, list[str]] = {
        a.id: [d for d in a.depends_on if d in id_map]
        for a in actions
    }

    # ── 2. Build edges ─────────────────────────────────────────────────────
    for target_id, sources in valid_deps.items():
        for source_id in sources:
            dep_type = id_map[target_id].dependency_type
            edges.append(GraphEdge(
                id=f"{source_id}-{target_id}",
                source=source_id,
                target=target_id,
                dependency_type=dep_type,
            ))

    # ── 3. Detect circular dependencies (iterative DFS) ───────────────────
    cycles_found: set[frozenset] = set()

    def _find_cycle(start: str) -> Optional[list[str]]:
        """Return the cycle path starting from `start`, or None."""
        visited: set[str] = set()
        path: list[str] = []

        def dfs(node: str) -> bool:
            if node in visited:
                # found a back-edge; extract the cycle
                cycle_start = path.index(node)
                return path[cycle_start:]
            visited.add(node)
            path.append(node)
            for src in valid_deps.get(node, []):
                result = dfs(src)
                if result is not False:
                    return result
            path.pop()
            visited.discard(node)
            return False

        return dfs(start)

    all_cycle_nodes: set[str] = set()
    for action_id in id_map:
        cycle = _find_cycle(action_id)
        if cycle and isinstance(cycle, list):
            key = frozenset(cycle)
            if key not in cycles_found:
                cycles_found.add(key)
                all_cycle_nodes.update(cycle)
                conflicts.append(Conflict(
                    type="CIRCULAR_DEPENDENCY",
                    severity="high",
                    cycle=cycle,
                    message=(
                        f"Circular dependency detected: "
                        + " → ".join(cycle)
                        + f" → {cycle[0]}"
                    ),
                ))

    # ── 4. Detect schedule conflicts ───────────────────────────────────────
    for target_id, sources in valid_deps.items():
        target = id_map[target_id]
        if target.due_date is None:
            continue
        for source_id in sources:
            source = id_map[source_id]
            if source.due_date is None:
                continue
            # Conflict: target must wait for source, but target is due earlier
            if target.due_date < source.due_date:
                conflicts.append(Conflict(
                    type="SCHEDULE_CONFLICT",
                    severity="high",
                    source_action_id=source_id,
                    target_action_id=target_id,
                    message=(
                        f"{target_id} is due {target.due_date} but depends on "
                        f"{source_id} which is not due until {source.due_date}."
                    ),
                ))

    # ── 5. Determine blocked tasks ─────────────────────────────────────────
    INCOMPLETE = {"open", "in_progress", "blocked"}

    # Precompute reverse map: which tasks does each action block?
    blocks_map: dict[str, list[str]] = {a.id: [] for a in actions}
    for target_id, sources in valid_deps.items():
        for src in sources:
            blocks_map[src].append(target_id)

    blocked_by: dict[str, list[str]] = {a.id: [] for a in actions}
    for target_id, sources in valid_deps.items():
        for src in sources:
            if id_map[src].status in INCOMPLETE:
                blocked_by[target_id].append(src)

    # ── 6. Build GraphNodes ────────────────────────────────────────────────
    nodes: list[GraphNode] = []
    for action in actions:
        bby = blocked_by[action.id]
        is_blocked = len(bby) > 0 and action.status not in ("done",)
        nodes.append(GraphNode(
            id=action.id,
            task=action.task,
            owner=action.owner,
            due_date=action.due_date,
            priority=action.priority,
            status=action.status,
            is_blocked=is_blocked,
            blocked_by=bby,
            meeting_id=action.meeting_id,
            meeting_title=action.meeting_title,
            depends_on=valid_deps.get(action.id, []),
            dependents=blocks_map.get(action.id, []),
        ))

    # ── 7. Health summary ──────────────────────────────────────────────────
    health = DependencyHealth(
        total=len(actions),
        completed=sum(1 for a in actions if a.status == "done"),
        in_progress=sum(1 for a in actions if a.status == "in_progress"),
        open=sum(1 for a in actions if a.status == "open"),
        blocked=sum(
            1 for n in nodes
            if n.is_blocked and id_map[n.id].status != "done"
        ),
        schedule_conflicts=sum(
            1 for c in conflicts if c.type == "SCHEDULE_CONFLICT"
        ),
        circular_dependencies=sum(
            1 for c in conflicts if c.type == "CIRCULAR_DEPENDENCY"
        ),
    )

    return GraphResult(nodes=nodes, edges=edges, conflicts=conflicts, health=health)


# ---------------------------------------------------------------------------
# Convenience serialiser — converts GraphResult → JSON-ready dict
# ---------------------------------------------------------------------------

def serialise(result: GraphResult) -> dict:
    """Convert a GraphResult to a plain dict suitable for JSON serialisation."""

    def _date(d: Optional[date]) -> Optional[str]:
        return d.isoformat() if d else None

    nodes_out = []
    for n in result.nodes:
        nodes_out.append({
            "id": n.id,
            "type": n.type,
            "data": {
                "task": n.task,
                "owner": n.owner,
                "due_date": _date(n.due_date),
                "priority": n.priority,
                "status": n.status,
                "is_blocked": n.is_blocked,
                "blocked_by": n.blocked_by,
                "meeting_id": n.meeting_id,
                "meeting_title": n.meeting_title,
                "depends_on": n.depends_on,
                "dependents": n.dependents,
            },
        })

    edges_out = [
        {
            "id": e.id,
            "source": e.source,
            "target": e.target,
            "type": e.type,
            "dependency_type": e.dependency_type,
        }
        for e in result.edges
    ]

    conflicts_out = []
    for c in result.conflicts:
        d = {
            "type": c.type,
            "severity": c.severity,
            "message": c.message,
        }
        if c.source_action_id:
            d["source_action_id"] = c.source_action_id
        if c.target_action_id:
            d["target_action_id"] = c.target_action_id
        if c.cycle:
            d["cycle"] = c.cycle
        conflicts_out.append(d)

    health = {
        "total": result.health.total,
        "completed": result.health.completed,
        "in_progress": result.health.in_progress,
        "open": result.health.open,
        "blocked": result.health.blocked,
        "schedule_conflicts": result.health.schedule_conflicts,
        "circular_dependencies": result.health.circular_dependencies,
    }

    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "conflicts": conflicts_out,
        "health": health,
    }
