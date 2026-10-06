"""
Tests for services/dependency_engine.py

Run with:  python -m pytest test_dependency_engine.py -v
(No database required — engine is pure Python.)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date
import pytest
from services.dependency_engine import ActionNode, analyse, serialise


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make(id, status="open", due=None, deps=None):
    return ActionNode(
        id=id,
        task=f"Task {id}",
        owner=None,
        due_date=date.fromisoformat(due) if due else None,
        priority="MEDIUM",
        status=status,
        depends_on=deps or [],
    )


def conflict_types(result):
    return [c.type for c in result.conflicts]


# ---------------------------------------------------------------------------
# Test 1: No dependencies
# ---------------------------------------------------------------------------

def test_no_dependencies():
    nodes = [make("A1"), make("A2"), make("A3")]
    r = analyse(nodes)
    assert r.health.total == 3
    assert len(r.edges) == 0
    assert r.conflicts == []
    assert r.health.blocked == 0


# ---------------------------------------------------------------------------
# Test 2: Simple A1 → A2
# ---------------------------------------------------------------------------

def test_simple_dependency():
    nodes = [make("A1", status="open"), make("A2", status="open", deps=["A1"])]
    r = analyse(nodes)
    assert len(r.edges) == 1
    assert r.edges[0].source == "A1"
    assert r.edges[0].target == "A2"
    assert r.conflicts == []
    # A2 is blocked because A1 is not done
    a2 = next(n for n in r.nodes if n.id == "A2")
    assert a2.is_blocked
    assert "A1" in a2.blocked_by


# ---------------------------------------------------------------------------
# Test 3: Chain A1 → A2 → A3
# ---------------------------------------------------------------------------

def test_chain():
    nodes = [
        make("A1", status="open"),
        make("A2", status="open", deps=["A1"]),
        make("A3", status="open", deps=["A2"]),
    ]
    r = analyse(nodes)
    assert len(r.edges) == 2
    edge_pairs = {(e.source, e.target) for e in r.edges}
    assert ("A1", "A2") in edge_pairs
    assert ("A2", "A3") in edge_pairs
    assert r.conflicts == []
    a3 = next(n for n in r.nodes if n.id == "A3")
    assert a3.is_blocked
    assert "A2" in a3.blocked_by


# ---------------------------------------------------------------------------
# Test 4: Multiple dependencies — A3 depends on A1 AND A2
# ---------------------------------------------------------------------------

def test_multiple_dependencies():
    nodes = [
        make("A1", status="done"),
        make("A2", status="open"),
        make("A3", status="open", deps=["A1", "A2"]),
    ]
    r = analyse(nodes)
    assert len(r.edges) == 2
    a3 = next(n for n in r.nodes if n.id == "A3")
    # A1 is done so doesn't block; A2 is open so it does
    assert a3.is_blocked
    assert "A2" in a3.blocked_by
    assert "A1" not in a3.blocked_by


# ---------------------------------------------------------------------------
# Test 5: Circular dependency A1 → A2 → A1
# ---------------------------------------------------------------------------

def test_circular_dependency():
    nodes = [
        make("A1", deps=["A2"]),
        make("A2", deps=["A1"]),
    ]
    r = analyse(nodes)
    assert any(c.type == "CIRCULAR_DEPENDENCY" for c in r.conflicts)


# ---------------------------------------------------------------------------
# Test 6a: Deadline conflict — A2 due BEFORE A1 (conflict expected)
# ---------------------------------------------------------------------------

def test_deadline_conflict():
    nodes = [
        make("A1", due="2026-10-15"),
        make("A2", due="2026-10-12", deps=["A1"]),
    ]
    r = analyse(nodes)
    assert "SCHEDULE_CONFLICT" in conflict_types(r)
    sc = next(c for c in r.conflicts if c.type == "SCHEDULE_CONFLICT")
    assert sc.source_action_id == "A1"
    assert sc.target_action_id == "A2"


# ---------------------------------------------------------------------------
# Test 6b: No conflict — A1 due before A2 (valid ordering)
# ---------------------------------------------------------------------------

def test_no_deadline_conflict():
    nodes = [
        make("A1", due="2026-10-10"),
        make("A2", due="2026-10-12", deps=["A1"]),
    ]
    r = analyse(nodes)
    assert "SCHEDULE_CONFLICT" not in conflict_types(r)


# ---------------------------------------------------------------------------
# Test 7: Blocked task
# ---------------------------------------------------------------------------

def test_blocked_task():
    nodes = [
        make("A1", status="in_progress"),
        make("A2", status="open", deps=["A1"]),
    ]
    r = analyse(nodes)
    a2 = next(n for n in r.nodes if n.id == "A2")
    assert a2.is_blocked
    assert "A1" in a2.blocked_by


# ---------------------------------------------------------------------------
# Test 8: Completed dependency unblocks dependent
# ---------------------------------------------------------------------------

def test_completed_dependency_unblocks():
    nodes = [
        make("A1", status="done"),
        make("A2", status="open", deps=["A1"]),
    ]
    r = analyse(nodes)
    a2 = next(n for n in r.nodes if n.id == "A2")
    assert not a2.is_blocked
    assert a2.blocked_by == []


# ---------------------------------------------------------------------------
# Test 9: Project isolation — engine only sees what it's given
# ---------------------------------------------------------------------------

def test_project_isolation():
    # Project A nodes
    proj_a = [make("A1"), make("A2", deps=["A1"])]
    # Project B nodes (same IDs, different data)
    proj_b = [make("A1", status="done"), make("A2", status="done")]

    r_a = analyse(proj_a)
    r_b = analyse(proj_b)

    a2_in_a = next(n for n in r_a.nodes if n.id == "A2")
    a2_in_b = next(n for n in r_b.nodes if n.id == "A2")

    # Project A: A2 is blocked
    assert a2_in_a.is_blocked
    # Project B: A2 is done, not blocked
    assert not a2_in_b.is_blocked
    assert r_b.health.completed == 2


# ---------------------------------------------------------------------------
# Test 10: Invalid dependency ID is flagged as INVALID_REFERENCE
# ---------------------------------------------------------------------------

def test_invalid_dependency_id():
    nodes = [
        make("A1"),
        make("A2", deps=["A99"]),   # A99 does not exist
    ]
    r = analyse(nodes)
    assert "INVALID_REFERENCE" in conflict_types(r)
    inv = next(c for c in r.conflicts if c.type == "INVALID_REFERENCE")
    assert inv.source_action_id == "A99"
    assert inv.target_action_id == "A2"
    # Invalid ref is stripped from edges — no dangling edge
    assert not any(e.source == "A99" for e in r.edges)


# ---------------------------------------------------------------------------
# Test 11: serialise() produces correct JSON-ready structure
# ---------------------------------------------------------------------------

def test_serialise_structure():
    nodes = [
        make("A1", due="2026-10-10", status="done"),
        make("A2", due="2026-10-14", deps=["A1"]),
    ]
    r   = analyse(nodes)
    out = serialise(r)

    assert "nodes" in out and "edges" in out and "conflicts" in out and "health" in out
    node_ids = {n["id"] for n in out["nodes"]}
    assert "A1" in node_ids and "A2" in node_ids
    edge = out["edges"][0]
    assert edge["source"] == "A1" and edge["target"] == "A2"
    assert out["health"]["total"] == 2
    assert out["health"]["completed"] == 1


if __name__ == "__main__":
    # Allow running directly without pytest
    import traceback
    tests = [
        test_no_dependencies,
        test_simple_dependency,
        test_chain,
        test_multiple_dependencies,
        test_circular_dependency,
        test_deadline_conflict,
        test_no_deadline_conflict,
        test_blocked_task,
        test_completed_dependency_unblocks,
        test_project_isolation,
        test_invalid_dependency_id,
        test_serialise_structure,
    ]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {t.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
