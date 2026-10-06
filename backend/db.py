"""
Database models and initialization.

Tables
------
users            – registered accounts
projects         – organizational units
project_members  – many-to-many users ↔ projects with a role
meetings         – analyzed meetings belonging to a project

The old schema had Meeting.project (str) and Meeting.team (str) at the top level.
Those columns are kept as nullable strings so the existing quorum.db rows aren't lost.
New rows always carry project_id + created_by.
"""
from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, text

engine = create_engine("sqlite:///quorum.db", connect_args={"check_same_thread": False})


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str = ""
    created_by: int = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Project members
# ---------------------------------------------------------------------------

class ProjectMember(SQLModel, table=True):
    __tablename__ = "project_members"

    project_id: int = Field(foreign_key="projects.id", primary_key=True)
    user_id: int = Field(foreign_key="users.id", primary_key=True)
    role: str = "MEMBER"      # OWNER | MEMBER
    status: str = "accepted"  # accepted | pending
    joined_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Action items  (flattened from meeting result JSON for graph queries)
# ---------------------------------------------------------------------------

class ActionRecord(SQLModel, table=True):
    """
    Normalised store of every action item extracted across all meetings.
    The canonical source of truth is still Meeting.result (JSON blob);
    this table is a projection that the dependency engine reads/writes.
    Key: (project_id, action_id) — action_id is the LLM-assigned string
    like "A1", scoped to a project so the same string in different
    projects never collides.
    """
    __tablename__ = "action_records"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int  = Field(foreign_key="projects.id",  index=True)
    meeting_id: int  = Field(foreign_key="meetings.id",  index=True)
    action_id: str   = Field(index=True)   # e.g. "A1" — unique within a project
    task: str
    owner: Optional[str] = None
    due_date: Optional[date] = None
    priority: str = "MEDIUM"
    status: str   = "open"
    dependency_type: str = "BLOCKING"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Dependency edges  (source → target means target depends on source)
# ---------------------------------------------------------------------------

class ActionDep(SQLModel, table=True):
    """
    Directed edge: source_action_id → target_action_id
    Read as: target_action_id DEPENDS ON source_action_id.
    Both sides reference ActionRecord.action_id strings (not DB PKs)
    so the engine works purely with the LLM IDs.
    """
    __tablename__ = "action_deps"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id:        int = Field(foreign_key="projects.id", index=True)
    source_action_id:  str = Field(index=True)   # must finish first
    target_action_id:  str = Field(index=True)   # depends on source
    dependency_type:   str = "BLOCKING"


# ---------------------------------------------------------------------------
# Meetings  (extended; old columns kept nullable for migration)
# ---------------------------------------------------------------------------

class Meeting(SQLModel, table=True):
    __tablename__ = "meetings"

    id: Optional[int] = Field(default=None, primary_key=True)

    # New FK columns (nullable so existing rows survive ALTER TABLE)
    project_id: Optional[int] = Field(default=None, foreign_key="projects.id", index=True)
    created_by: Optional[int] = Field(default=None, foreign_key="users.id")

    # Kept from old schema — still populated for legacy rows
    project: str = Field(default="General", index=True)
    team: str = Field(default="General")

    title: str
    meeting_date: date
    input_type: str = "text"
    raw_text: str
    result: str   # JSON blob (Extraction)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Schema init + lightweight migration
# ---------------------------------------------------------------------------

def _add_column_if_missing(conn, table: str, column: str, definition: str) -> None:
    """SQLite doesn't support IF NOT EXISTS for ALTER TABLE columns."""
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    existing = {r[1] for r in rows}
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    # Migrate existing tables that predate new columns.
    with engine.begin() as conn:
        _add_column_if_missing(conn, "meetings",        "project_id",       "INTEGER REFERENCES projects(id)")
        _add_column_if_missing(conn, "meetings",        "created_by",       "INTEGER REFERENCES users(id)")
        _add_column_if_missing(conn, "project_members", "status",           "TEXT NOT NULL DEFAULT 'accepted'")
        # action_records / action_deps created fresh by create_all above;
        # guard against column additions in future schema iterations.
        _add_column_if_missing(conn, "action_records",  "dependency_type",  "TEXT NOT NULL DEFAULT 'BLOCKING'")


def get_session():
    with Session(engine) as session:
        yield session
