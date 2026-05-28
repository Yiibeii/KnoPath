import sys
import os
import threading

if sys.platform == 'win32':
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    os.environ.setdefault('PYTHONUTF8', '1')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import initialize_database, dispose_database, get_db
from routes import router
from logger import get_logger
from file_watcher import init_file_watcher, get_file_watcher
from services.sync_service import handle_file_change
from config import ensure_repository_structure, get_storage_path
import asyncio
from typing import List
from contextlib import asynccontextmanager

logger = get_logger('main')

initialize_database()

active_websockets: List = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    if sys.platform == 'win32':
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')

    logger.info("KnoPath API starting up")
    logger.info(f"PYTHONUTF8={os.environ.get('PYTHONUTF8', 'not set')}, "
                f"PYTHONIOENCODING={os.environ.get('PYTHONIOENCODING', 'not set')}, "
                f"stdout.encoding={getattr(sys.stdout, 'encoding', 'N/A')}, "
                f"filesystem encoding={sys.getfilesystemencoding()}")

    ensure_repository_structure()

    loop = asyncio.get_running_loop()

    def file_change_callback(file_path: str, event_type: str):
        asyncio.run_coroutine_threadsafe(
            handle_file_change(file_path, event_type, active_websockets),
            loop
        )

    init_file_watcher(get_storage_path(), file_change_callback)

    def _initial_sync():
        """Bidirectional sync: reconcile DB and filesystem on startup."""
        import os
        from datetime import datetime, timezone
        from services.file_storage import (
            parse_markdown, build_node_content,
            sanitize_filename, format_timestamp_from_iso,
        )
        from services.wiki_service import (
            sync_wiki_pages_from_files, save_wiki_page_file,
            _wiki_dir, sanitize_wiki_filename, _parse_wiki_page_file,
        )
        from models import Project, Node, Edge, WikiPage, WikiLink
        import uuid as uuid_mod

        def _parse_ts(ts_str):
            """Parse ISO timestamp string to datetime, return None on failure."""
            if not ts_str:
                return None
            try:
                return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                return None

        storage = get_storage_path()
        raw_dir = os.path.join(storage, "raw")
        wiki_dir = os.path.join(storage, "wiki")
        db = next(get_db())
        try:
            # ── Raw files: bidirectional sync ──
            if os.path.isdir(raw_dir):
                # Build file map: node_id → (filepath, file_updated, node_data)
                file_nodes = {}
                for project_name in os.listdir(raw_dir):
                    project_path = os.path.join(raw_dir, project_name)
                    if not os.path.isdir(project_path):
                        continue
                    for root, _, files in os.walk(project_path):
                        for f in files:
                            if not f.endswith('.md'):
                                continue
                            filepath = os.path.join(root, f)
                            try:
                                with open(filepath, 'r', encoding='utf-8') as fh:
                                    content = fh.read()
                                frontmatter, sections, title = parse_markdown(content)
                                node_id = frontmatter.get('id') or str(uuid_mod.uuid4())
                                file_updated = _parse_ts(frontmatter.get('updated'))
                                parent_id = frontmatter.get('parent_id')
                                if parent_id in ('None', 'null', '', 'none'):
                                    parent_id = None
                                file_nodes[node_id] = {
                                    'filepath': filepath,
                                    'project_name': project_name,
                                    'file_updated': file_updated,
                                    'question': sections.get('Question', title or ''),
                                    'answer': sections.get('Answer', ''),
                                    'summary': sections.get('Summary', ''),
                                    'context': sections.get('Context', ''),
                                    'parent_id': parent_id,
                                }
                            except Exception as e:
                                logger.warning(f"Initial sync: failed to parse {filepath}: {e}")

                # Build DB map: node_id → db_node
                db_nodes = {n.id: n for n in db.query(Node).all()}

                file_ids = set(file_nodes.keys())
                db_ids = set(db_nodes.keys())

                # 1) Files only → create in DB
                from sqlalchemy.exc import IntegrityError
                for nid in file_ids - db_ids:
                    info = file_nodes[nid]
                    project = db.query(Project).filter(Project.title == info['project_name']).first()
                    if not project:
                        project = Project(id=str(uuid_mod.uuid4()), title=info['project_name'],
                                          node_count=0, is_favorite=False)
                        db.add(project)
                        db.flush()
                    parent_id = info['parent_id']
                    if parent_id and parent_id not in db_ids:
                        parent_id = None
                    savepoint = db.begin_nested()
                    try:
                        db.add(Node(
                            id=nid, project_id=project.id, parent_id=parent_id,
                            node_type='branch' if parent_id else 'root',
                            question=info['question'], answer=info['answer'],
                            summary=info['summary'], context=info['context'],
                        ))
                        savepoint.commit()
                        logger.info(f"Sync ↑ file→DB: created node {nid}")
                    except IntegrityError:
                        savepoint.rollback()
                        existing = db.query(Node).filter(Node.id == nid).first()
                        if existing:
                            existing.question = info['question']
                            existing.answer = info['answer']
                            existing.summary = info['summary']
                            existing.context = info['context']
                            existing.parent_id = parent_id
                            existing.node_type = 'branch' if parent_id else 'root'
                            logger.info(f"Sync ↑ file→DB: node {nid} already exists, updated instead")

                # 2) DB only → write file
                for nid in db_ids - file_ids:
                    node = db_nodes[nid]
                    project = db.query(Project).filter(Project.id == node.project_id).first()
                    if not project:
                        continue
                    raw_subdir = os.path.join(raw_dir, sanitize_filename(project.title))
                    os.makedirs(raw_subdir, exist_ok=True)
                    ts = format_timestamp_from_iso(node.created_at.isoformat()) if node.created_at else ''
                    filename = f"{ts}-{sanitize_filename(node.question or 'node')[:30]}.md"
                    filepath = os.path.join(raw_subdir, filename)
                    from schemas import NodeBase, NodeDataBase
                    node_base = NodeBase(
                        id=node.id, type="knopath",
                        position={"x": node.position_x or 96, "y": node.position_y or 120},
                        width=node.width or 290, height=node.height or 380,
                        data=NodeDataBase(
                            parentId=node.parent_id, type=node.node_type,
                            question=node.question, answer=node.answer,
                            summary=node.summary or '', context=node.context or '',
                            childrenCount=node.children_count or 0,
                            createdAt=node.created_at.isoformat() if node.created_at else None,
                            updatedAt=node.updated_at.isoformat() if node.updated_at else None,
                        ),
                    )
                    content = build_node_content(node_base, project.title, [node.question or ''])
                    with open(filepath, 'w', encoding='utf-8') as fh:
                        fh.write(content)
                    logger.info(f"Sync ↓ DB→file: wrote node {nid} to {filepath}")

                # 3) Both exist → compare timestamps
                for nid in file_ids & db_ids:
                    info = file_nodes[nid]
                    node = db_nodes[nid]
                    file_ts = info['file_updated']
                    db_ts = node.updated_at
                    # Normalize to UTC-aware
                    if db_ts and db_ts.tzinfo is None:
                        db_ts = db_ts.replace(tzinfo=timezone.utc)
                    if file_ts and file_ts.tzinfo is None:
                        file_ts = file_ts.replace(tzinfo=timezone.utc)

                    if file_ts and db_ts and file_ts > db_ts:
                        # File is newer → update DB
                        parent_id = info['parent_id']
                        if parent_id and parent_id not in db_ids:
                            parent_id = None
                        node.question = info['question']
                        node.answer = info['answer']
                        node.summary = info['summary']
                        node.context = info['context']
                        node.parent_id = parent_id
                        node.node_type = 'branch' if parent_id else 'root'
                        logger.info(f"Sync ↑ file→DB: updated node {nid}")
                    elif db_ts and (not file_ts or db_ts > file_ts):
                        # DB is newer → overwrite existing file
                        project = db.query(Project).filter(Project.id == node.project_id).first()
                        if project:
                            from schemas import NodeBase, NodeDataBase
                            node_base = NodeBase(
                                id=node.id, type="knopath",
                                position={"x": node.position_x or 96, "y": node.position_y or 120},
                                width=node.width or 290, height=node.height or 380,
                                data=NodeDataBase(
                                    parentId=node.parent_id, type=node.node_type,
                                    question=node.question, answer=node.answer,
                                    summary=node.summary or '', context=node.context or '',
                                    childrenCount=node.children_count or 0,
                                    createdAt=node.created_at.isoformat() if node.created_at else None,
                                    updatedAt=node.updated_at.isoformat() if node.updated_at else None,
                                ),
                            )
                            content = build_node_content(node_base, project.title, [node.question or ''])
                            with open(info['filepath'], 'w', encoding='utf-8') as fh:
                                fh.write(content)
                            logger.info(f"Sync ↓ DB→file: rewrote node {nid}")

                # Update node counts
                for project in db.query(Project).all():
                    project.node_count = db.query(Node).filter(Node.project_id == project.id).count()

                db.commit()
                logger.info(f"Raw sync done: {len(file_ids - db_ids)} up, {len(db_ids - file_ids)} down, {len(file_ids & db_ids)} compared")

            # ── Wiki files: bidirectional sync ──
            if os.path.isdir(wiki_dir):
                # First: file → DB via existing function
                sync_wiki_pages_from_files(db)

                # Second: DB only → write file
                db_pages = {p.id: p for p in db.query(WikiPage).all()}
                file_page_ids = set()
                for project_name in os.listdir(wiki_dir):
                    project_path = os.path.join(wiki_dir, project_name)
                    if not os.path.isdir(project_path):
                        continue
                    for root, _, files in os.walk(project_path):
                        for f in files:
                            if not f.endswith('.md'):
                                continue
                            try:
                                page = _parse_wiki_page_file(os.path.join(root, f), project_name, db)
                                file_page_ids.add(page.id)
                            except Exception:
                                pass

                for pid in set(db_pages.keys()) - file_page_ids:
                    page = db_pages[pid]
                    # Find project title from source_project_id
                    project_title = "Unknown"
                    if page.source_project_id:
                        project = db.query(Project).filter(Project.id == page.source_project_id).first()
                        if project:
                            project_title = project.title
                    try:
                        save_wiki_page_file(page, project_title)
                        logger.info(f"Sync ↓ DB→file: wrote wiki page {pid}")
                    except Exception as e:
                        logger.warning(f"Failed to write wiki page {pid}: {e}")

                db.commit()
                logger.info("Wiki sync done")
        except Exception as e:
            logger.error(f"Initial sync failed: {e}")
            db.rollback()
        finally:
            db.close()

    threading.Thread(target=_initial_sync, daemon=True).start()

    try:
        yield
    finally:
        watcher = get_file_watcher()
        if watcher:
            watcher.stop()
        dispose_database()
        logger.info("KnoPath API shutting down")


app = FastAPI(
    title="KnoPath API",
    description="Backend API for KnoPath - Branching knowledge workspace",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    logger.debug("Root endpoint accessed")
    return {"message": "KnoPath API is running", "version": "1.0.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/v1/health")
def health_check_v1():
    return {"status": "healthy"}
