from datetime import date, datetime, timezone

from sqlmodel import Field, Session, SQLModel, create_engine

engine = create_engine("sqlite:///quorum.db", connect_args={"check_same_thread": False})


class Meeting(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    project: str = Field(index=True)
    team: str
    meeting_date: date
    input_type: str = "text"
    raw_text: str
    # ponytail: extraction (incl. review/status edits) stored as one JSON blob per meeting.
    # Fine for per-meeting review; move items to their own tables if cross-meeting queries get slow.
    result: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
