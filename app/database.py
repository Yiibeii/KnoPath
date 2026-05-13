from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

from config import get_database_url


def _create_sqlite_engine(database_url: str):
    next_engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False, "timeout": 30},
        pool_pre_ping=True,
    )

    @event.listens_for(next_engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    return next_engine


engine = _create_sqlite_engine(get_database_url())
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    _run_migrations(engine)


def _run_migrations(engine) -> None:
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))

        result = conn.execute(text(
            "SELECT COUNT(*) FROM pragma_table_info('wiki_pages') WHERE name='canonical_title'"
        ))
        if result.scalar() == 0:
            conn.execute(text("ALTER TABLE wiki_pages ADD COLUMN canonical_title VARCHAR"))
            conn.commit()

        # Add pending_links column
        result = conn.execute(text(
            "SELECT COUNT(*) FROM pragma_table_info('wiki_pages') WHERE name='pending_links'"
        ))
        if result.scalar() == 0:
            conn.execute(text("ALTER TABLE wiki_pages ADD COLUMN pending_links TEXT"))
            conn.commit()

        try:
            result = conn.execute(text("SELECT COUNT(*) FROM wiki_page_sources"))
            has_sources = result.scalar() > 0
        except Exception:
            has_sources = False

        if not has_sources:
            try:
                conn.execute(text(
                    "INSERT OR IGNORE INTO wiki_page_sources (id, page_id, node_id, project_id) "
                    "SELECT lower(hex(randomblob(16))), id, source_node_id, source_project_id "
                    "FROM wiki_pages WHERE source_node_id IS NOT NULL"
                ))
                conn.commit()
            except Exception:
                conn.rollback()


def reconfigure_database(database_url: str | None = None):
    global engine
    next_database_url = database_url or get_database_url()
    engine.dispose()
    engine = _create_sqlite_engine(next_database_url)
    SessionLocal.configure(bind=engine)
    initialize_database()
    return engine


def dispose_database() -> None:
    engine.dispose()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
