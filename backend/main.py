import json
import logging
from contextlib import asynccontextmanager
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from auth import create_token, current_user, hash_password, verify_password  # noqa: E402
from db import ActionDep, ActionRecord, Meeting, Project, ProjectMember, User, get_session, init_db  # noqa: E402
from extract import extract, verify_evidence  # noqa: E402
from ingest import ingest  # noqa: E402
from schemas import (  # noqa: E402
    AddMemberRequest,
    AnalyzeRequest,
    Extraction,
    InvitationOut,
    MemberOut,
    ProjectCreate,
    ProjectOut,
    SignInRequest,
    SignUpRequest,
    TokenResponse,
)
from services.dependency_engine import ActionNode, analyse, serialise  # noqa: E402

log = logging.getLogger("quorum")
MAX_UPLOAD = 50 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Quorum", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _meeting_to_dict(m: Meeting) -> dict:
    return {**m.model_dump(exclude={"result"}), "result": json.loads(m.result)}


def _sync_deps(session: Session, meeting: Meeting, extraction: Extraction) -> None:
    """
    After a meeting is saved / reviewed, upsert ActionRecord rows and
    ActionDep edges for this meeting into the normalised tables.

    Strategy:
    - Delete then re-insert records for *this meeting* so status/owner
      edits made during review are reflected.
    - Dep edges are project-scoped; we delete edges whose target belongs
      to this meeting before re-inserting so cross-meeting references
      survive in other rows.
    """
    if not meeting.project_id:
        return

    pid = meeting.project_id
    mid = meeting.id

    # ── 1. Remove existing ActionRecord rows for this meeting ──────────────
    old_records = session.exec(
        select(ActionRecord).where(
            ActionRecord.project_id == pid,
            ActionRecord.meeting_id == mid,
        )
    ).all()
    old_ids = {r.action_id for r in old_records}
    for r in old_records:
        session.delete(r)

    # ── 2. Remove ActionDep edges whose target was owned by this meeting ───
    if old_ids:
        old_deps = session.exec(
            select(ActionDep).where(
                ActionDep.project_id == pid,
                ActionDep.target_action_id.in_(old_ids),
            )
        ).all()
        for d in old_deps:
            session.delete(d)

    session.flush()

    # ── 3. Insert fresh ActionRecord rows ──────────────────────────────────
    new_ids: set[str] = set()
    for a in extraction.action_items:
        session.add(ActionRecord(
            project_id=pid,
            meeting_id=mid,
            action_id=a.id,
            task=a.task,
            owner=a.owner,
            due_date=a.due_date,
            priority=a.priority,
            status=a.status,
            dependency_type=a.dependency_type,
        ))
        new_ids.add(a.id)

    session.flush()

    # ── 4. Insert ActionDep edges for new items ────────────────────────────
    # Collect all known action IDs for this project (old meetings + this one)
    all_project_ids = {
        r.action_id
        for r in session.exec(
            select(ActionRecord).where(ActionRecord.project_id == pid)
        ).all()
    }

    for a in extraction.action_items:
        for dep_id in a.depends_on:
            if dep_id in all_project_ids and dep_id != a.id:
                session.add(ActionDep(
                    project_id=pid,
                    source_action_id=dep_id,
                    target_action_id=a.id,
                    dependency_type=a.dependency_type,
                ))

    session.flush()


def _get_meeting_or_404(session: Session, meeting_id: int) -> Meeting:
    m = session.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    return m


def _assert_project_access(session: Session, project_id: int, user: User) -> Project:
    """Raises 403 unless the user has an *accepted* membership."""
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    mem = session.get(ProjectMember, (project_id, user.id))
    if not mem or mem.status != "accepted":
        raise HTTPException(403, "You are not a member of this project")
    return proj


def _project_out(proj: Project, session: Session) -> ProjectOut:
    meetings = session.exec(
        select(Meeting).where(Meeting.project_id == proj.id)
    ).all()

    open_actions = 0
    for m in meetings:
        try:
            ex = Extraction.model_validate_json(m.result)
            open_actions += sum(
                1 for a in ex.action_items if a.status in ("open", "in_progress", "blocked")
            )
        except Exception:
            pass

    # Only count accepted members
    member_count = len(
        session.exec(
            select(ProjectMember).where(
                ProjectMember.project_id == proj.id,
                ProjectMember.status == "accepted",
            )
        ).all()
    )

    return ProjectOut(
        id=proj.id,
        name=proj.name,
        description=proj.description,
        created_by=proj.created_by,
        created_at=proj.created_at,
        meeting_count=len(meetings),
        open_action_count=open_actions,
        member_count=member_count,
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Auth  —  /api/auth/*
# ---------------------------------------------------------------------------

@app.post("/api/auth/signup", response_model=TokenResponse)
def signup(req: SignUpRequest, session: Session = Depends(get_session)):
    existing = session.exec(select(User).where(User.email == req.email)).first()
    if existing:
        raise HTTPException(409, "An account with this email already exists")
    user = User(name=req.name, email=req.email, password_hash=hash_password(req.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    return TokenResponse(
        access_token=create_token(user.id),
        user_id=user.id,
        name=user.name,
        email=user.email,
    )


@app.post("/api/auth/signin", response_model=TokenResponse)
def signin(req: SignInRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == req.email)).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return TokenResponse(
        access_token=create_token(user.id),
        user_id=user.id,
        name=user.name,
        email=user.email,
    )


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return {"user_id": user.id, "name": user.name, "email": user.email}


# ---------------------------------------------------------------------------
# Projects  —  /api/projects/*
# ---------------------------------------------------------------------------

@app.post("/api/projects", status_code=201)
def create_project(
    req: ProjectCreate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    proj = Project(name=req.name, description=req.description, created_by=user.id)
    session.add(proj)
    session.flush()
    # Creator is automatically OWNER + already accepted
    session.add(ProjectMember(
        project_id=proj.id, user_id=user.id, role="OWNER", status="accepted"
    ))
    session.commit()
    session.refresh(proj)
    return _project_out(proj, session)


@app.get("/api/projects")
def list_projects(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    # Only show projects the user has *accepted*
    memberships = session.exec(
        select(ProjectMember).where(
            ProjectMember.user_id == user.id,
            ProjectMember.status == "accepted",
        )
    ).all()
    result = []
    for mem in memberships:
        proj = session.get(Project, mem.project_id)
        if proj:
            result.append(_project_out(proj, session))
    result.sort(key=lambda p: p.created_at, reverse=True)
    return result


@app.get("/api/projects/{project_id}")
def get_project(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    proj = _assert_project_access(session, project_id, user)
    return _project_out(proj, session)


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    _assert_project_access(session, project_id, user)
    mem = session.get(ProjectMember, (project_id, user.id))
    if not mem or mem.role != "OWNER":
        raise HTTPException(403, "Only the project owner can delete it")
    for m in session.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all():
        session.delete(m)
    for mtg in session.exec(select(Meeting).where(Meeting.project_id == project_id)).all():
        session.delete(mtg)
    proj = session.get(Project, project_id)
    session.delete(proj)
    session.commit()


# ---------------------------------------------------------------------------
# Project members  —  /api/projects/{id}/members
# ---------------------------------------------------------------------------

@app.get("/api/projects/{project_id}/members", response_model=list[MemberOut])
def list_members(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    _assert_project_access(session, project_id, user)
    members = session.exec(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
    ).all()
    result = []
    for mem in members:
        u = session.get(User, mem.user_id)
        if u:
            result.append(MemberOut(
                user_id=u.id, name=u.name, email=u.email,
                role=mem.role, status=mem.status, joined_at=mem.joined_at,
            ))
    return result


@app.post("/api/projects/{project_id}/members", status_code=201)
def invite_member(
    project_id: int,
    req: AddMemberRequest,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Send an invitation (creates a pending membership)."""
    _assert_project_access(session, project_id, user)
    caller_mem = session.get(ProjectMember, (project_id, user.id))
    if not caller_mem or caller_mem.role != "OWNER":
        raise HTTPException(403, "Only owners can invite members")
    target = session.exec(select(User).where(User.email == req.email)).first()
    if not target:
        raise HTTPException(404, f"No user found with email {req.email}")
    existing = session.get(ProjectMember, (project_id, target.id))
    if existing:
        raise HTTPException(409, "User has already been invited or is already a member")
    session.add(ProjectMember(
        project_id=project_id, user_id=target.id, role=req.role, status="pending"
    ))
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Invitations  —  /api/invitations/*
# ---------------------------------------------------------------------------

@app.get("/api/invitations")
def list_invitations(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Pending invitations for the current user."""
    pending = session.exec(
        select(ProjectMember).where(
            ProjectMember.user_id == user.id,
            ProjectMember.status == "pending",
        )
    ).all()
    result = []
    for mem in pending:
        proj = session.get(Project, mem.project_id)
        if not proj:
            continue
        inviter = session.get(User, proj.created_by)
        result.append(InvitationOut(
            project_id=proj.id,
            project_name=proj.name,
            invited_by_name=inviter.name if inviter else "Unknown",
            role=mem.role,
            joined_at=mem.joined_at,
        ))
    return result


@app.post("/api/invitations/{project_id}/accept", status_code=200)
def accept_invitation(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    mem = session.get(ProjectMember, (project_id, user.id))
    if not mem or mem.status != "pending":
        raise HTTPException(404, "No pending invitation found")
    mem.status = "accepted"
    session.add(mem)
    session.commit()
    return {"ok": True}


@app.post("/api/invitations/{project_id}/reject", status_code=200)
def reject_invitation(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    mem = session.get(ProjectMember, (project_id, user.id))
    if not mem or mem.status != "pending":
        raise HTTPException(404, "No pending invitation found")
    session.delete(mem)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# File ingestion
# ---------------------------------------------------------------------------

@app.post("/api/ingest")
def ingest_file(
    file: UploadFile,
    translate: bool = Form(True),
    user: User = Depends(current_user),
):
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File is larger than 50 MB")
    try:
        input_type, text = ingest(data, file.filename or "upload", translate)
    except ValueError as e:
        raise HTTPException(415, str(e))
    except Exception as e:
        log.exception("ingest failed")
        raise HTTPException(502, f"Could not read file: {e}")
    if not text.strip():
        raise HTTPException(422, "No text could be found in this file")
    return {"input_type": input_type, "text": text}


# ---------------------------------------------------------------------------
# Meeting analysis
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
def analyze(
    req: AnalyzeRequest,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    proj = _assert_project_access(session, req.project_id, user)
    meeting_date = req.meeting_date or date.today()
    try:
        result = extract(req.text, meeting_date)
    except Exception as e:
        log.exception("extraction failed")
        raise HTTPException(502, f"AI extraction failed: {e}")

    m = Meeting(
        project_id=req.project_id,
        created_by=user.id,
        project=proj.name,
        team=req.team,
        title=req.title,
        meeting_date=meeting_date,
        input_type=req.input_type,
        raw_text=req.text,
        result=result.model_dump_json(),
    )
    session.add(m)
    session.flush()   # get m.id before _sync_deps
    _sync_deps(session, m, result)
    session.commit()
    session.refresh(m)
    return _meeting_to_dict(m)


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

@app.get("/api/projects/{project_id}/meetings")
def list_project_meetings(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    _assert_project_access(session, project_id, user)
    meetings = session.exec(
        select(Meeting)
        .where(Meeting.project_id == project_id)
        .order_by(Meeting.created_at.desc())
    ).all()
    return _summarise_meetings(meetings)


@app.get("/api/meetings")
def list_meetings(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    memberships = session.exec(
        select(ProjectMember).where(
            ProjectMember.user_id == user.id,
            ProjectMember.status == "accepted",
        )
    ).all()
    project_ids = {mem.project_id for mem in memberships}
    if not project_ids:
        return []
    meetings = session.exec(
        select(Meeting)
        .where(Meeting.project_id.in_(project_ids))
        .order_by(Meeting.created_at.desc())
    ).all()
    return _summarise_meetings(meetings)


def _summarise_meetings(meetings) -> list[dict]:
    out = []
    for m in meetings:
        try:
            r = Extraction.model_validate_json(m.result)
        except Exception:
            continue
        items = [*r.decisions, *r.action_items, *r.risks]
        out.append({
            "id": m.id,
            "title": m.title,
            "project": m.project,
            "project_id": m.project_id,
            "team": m.team,
            "meeting_date": m.meeting_date,
            "input_type": m.input_type,
            "tone": r.tone,
            "summary": r.summary,
            "counts": {
                "decisions": len(r.decisions),
                "actions": len(r.action_items),
                "risks": len(r.risks),
                "pending": sum(i.review == "pending" for i in items),
            },
        })
    return out


@app.get("/api/meetings/{meeting_id}")
def get_meeting(
    meeting_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    m = _get_meeting_or_404(session, meeting_id)
    if m.project_id:
        _assert_project_access(session, m.project_id, user)
    return _meeting_to_dict(m)


@app.put("/api/meetings/{meeting_id}/result")
def save_review(
    meeting_id: int,
    result: Extraction,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    m = _get_meeting_or_404(session, meeting_id)
    if m.project_id:
        _assert_project_access(session, m.project_id, user)
    m.result = verify_evidence(result, m.raw_text).model_dump_json()
    session.add(m)
    _sync_deps(session, m, Extraction.model_validate_json(m.result))
    session.commit()
    return _meeting_to_dict(m)


@app.delete("/api/meetings/{meeting_id}", status_code=204)
def delete_meeting(
    meeting_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    m = _get_meeting_or_404(session, meeting_id)
    if m.project_id:
        _assert_project_access(session, m.project_id, user)
    session.delete(m)
    session.commit()


# ---------------------------------------------------------------------------
# Dependency Graph  —  /api/projects/{id}/dependency-graph
# ---------------------------------------------------------------------------

def _load_action_nodes(project_id: int, session: Session) -> list[ActionNode]:
    """Load all ActionRecord rows for a project and build ActionNode list."""
    records = session.exec(
        select(ActionRecord).where(ActionRecord.project_id == project_id)
    ).all()
    if not records:
        return []

    # Gather dep edges
    deps = session.exec(
        select(ActionDep).where(ActionDep.project_id == project_id)
    ).all()
    # target_id → [source_ids that target depends on]
    dep_map: dict[str, list[str]] = {}
    dep_type_map: dict[str, str] = {}
    for d in deps:
        dep_map.setdefault(d.target_action_id, []).append(d.source_action_id)
        dep_type_map[d.target_action_id] = d.dependency_type

    # Fetch meeting titles
    meeting_ids = {r.meeting_id for r in records}
    meetings = {
        m.id: m
        for m in session.exec(
            select(Meeting).where(Meeting.id.in_(meeting_ids))
        ).all()
    }

    nodes = []
    for r in records:
        mtg = meetings.get(r.meeting_id)
        nodes.append(ActionNode(
            id=r.action_id,
            task=r.task,
            owner=r.owner,
            due_date=r.due_date,
            priority=r.priority,
            status=r.status,
            depends_on=dep_map.get(r.action_id, []),
            dependency_type=dep_type_map.get(r.action_id, r.dependency_type),
            meeting_id=r.meeting_id,
            meeting_title=mtg.title if mtg else None,
        ))
    return nodes


@app.get("/api/projects/{project_id}/dependency-graph")
def get_dependency_graph(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Return the full dependency graph for a project."""
    _assert_project_access(session, project_id, user)
    nodes = _load_action_nodes(project_id, session)
    result = analyse(nodes)
    return serialise(result)


@app.get("/api/projects/{project_id}/dependency-health")
def get_dependency_health(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Return just the health summary (lightweight — no full graph payload)."""
    _assert_project_access(session, project_id, user)
    nodes = _load_action_nodes(project_id, session)
    result = analyse(nodes)
    return serialise(result)["health"]


# ---------------------------------------------------------------------------
# My tasks  —  action items assigned to the current user
# ---------------------------------------------------------------------------

@app.get("/api/tasks/mine")
def my_tasks(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """All open/in-progress action items assigned to the current user."""
    memberships = session.exec(
        select(ProjectMember).where(
            ProjectMember.user_id == user.id,
            ProjectMember.status == "accepted",
        )
    ).all()
    project_ids = {mem.project_id for mem in memberships}
    if not project_ids:
        return []

    meetings = session.exec(
        select(Meeting).where(Meeting.project_id.in_(project_ids))
    ).all()

    tasks = []
    for m in meetings:
        try:
            ex = Extraction.model_validate_json(m.result)
        except Exception:
            continue
        proj = session.get(Project, m.project_id)
        for action in ex.action_items:
            if action.assigned_to_id == user.id:
                tasks.append({
                    "meeting_id": m.id,
                    "meeting_title": m.title,
                    "project_id": m.project_id,
                    "project_name": proj.name if proj else "",
                    "action_id": action.id,
                    "task": action.task,
                    "owner": action.owner,
                    "due_date": action.due_date,
                    "priority": action.priority,
                    "status": action.status,
                    "review": action.review,
                })
    # Sort: open first, then by priority
    priority_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    tasks.sort(key=lambda t: (t["status"] == "done", priority_order.get(t["priority"], 9)))
    return tasks
