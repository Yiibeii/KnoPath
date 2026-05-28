import os
import re
import json
import asyncio
import threading
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from database import get_db
from models import Project, Node, Edge
from services.file_storage import parse_markdown
from services.wiki_service import sync_wiki_pages_from_files
from logger import get_logger
from config import get_storage_path

logger = get_logger('sync_service')

_wiki_sync_lock = threading.Lock()
_wiki_sync_pending = False


def _is_valid_content(question: str, answer: str) -> bool:
    """Check if the content is meaningful enough to create a node."""
    # Strip whitespace and check if there's actual content
    q = question.strip() if question else ''
    a = answer.strip() if answer else ''
    # Node is valid if at least one of question or answer has content
    return bool(q or a)


def _normalize_parent_id(parent_id: str | None) -> str | None:
    """Normalize parent_id from frontmatter."""
    if parent_id in ('None', 'null', '', 'none', 'None'):
        return None
    return parent_id


def _safe_get_node_id(file_path: str, frontmatter: dict) -> str:
    """Extract node ID from frontmatter or generate from filename."""
    node_id = frontmatter.get('id')
    if node_id:
        return node_id

    try:
        filename = os.path.basename(file_path)
        if isinstance(filename, bytes):
            filename = filename.decode('utf-8', errors='replace')
        node_id = filename.replace('.md', '')
        logger.warning(f"No id in frontmatter, using filename as node_id: {node_id}")
        return node_id
    except Exception as e:
        logger.error(f"Error processing filename {file_path}: {e}")
        return f"node_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"


def _update_node_children_count(db: Session, node_id: str | None) -> None:
    """Update children_count for a node."""
    if not node_id:
        return
    count = db.query(Node).filter(Node.parent_id == node_id).count()
    parent = db.query(Node).filter(Node.id == node_id).first()
    if parent:
        parent.children_count = count


def _collect_descendant_ids(db: Session, project_id: str, node_id: str) -> list[str]:
    """Collect all descendant node IDs recursively."""
    descendants = [node_id]
    seen = {node_id}
    index = 0
    while index < len(descendants):
        current_id = descendants[index]
        index += 1
        child_rows = db.query(Node.id).filter(
            Node.project_id == project_id,
            Node.parent_id == current_id,
        ).all()
        for (child_id,) in child_rows:
            if child_id not in seen:
                seen.add(child_id)
                descendants.append(child_id)
    return descendants


def _update_project_node_counts(db: Session, project_id: str) -> None:
    """Recalculate node_count for a project."""
    count = db.query(Node).filter(Node.project_id == project_id).count()
    project = db.query(Project).filter(Project.id == project_id).first()
    if project:
        project.node_count = count


def _broadcast(websockets: List, message: dict) -> None:
    """Send message to all connected WebSocket clients."""
    if not websockets:
        return
    message_json = json.dumps(message)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    for ws in websockets[:]:
        try:
            async def _send(ws=ws):
                await ws.send_text(message_json)

            if loop and loop.is_running():
                loop.create_task(_send())
            else:
                asyncio.run_coroutine_threadsafe(_send(), loop) if loop else None
        except Exception as e:
            logger.warning(f"Failed to send WebSocket message: {e}")
            websockets.remove(ws)


async def handle_file_change(file_path: str, event_type: str, websockets: List) -> None:
    """Handle file change events from the file watcher."""
    if not file_path.endswith('.md'):
        return

    logger.info(f"File change: {event_type} - {file_path}")

    # Extract project name from file path
    try:
        rel_path = os.path.relpath(file_path, get_storage_path())
        parts = rel_path.split(os.sep)
        if len(parts) < 2:
            logger.warning(f"File path too short to extract project: {file_path}")
            return
        content_type = parts[0]
        project_name = parts[1] if len(parts) > 1 else ""
    except Exception as e:
        logger.error(f"Error extracting project name from path: {file_path}, error: {e}")
        return

    db = next(get_db())
    try:
        if content_type == "wiki":
            global _wiki_sync_pending
            with _wiki_sync_lock:
                if _wiki_sync_pending:
                    logger.debug("Wiki sync already pending, skipping")
                    return
                _wiki_sync_pending = True
            try:
                sync_wiki_pages_from_files(db)
                _broadcast(websockets, {'type': 'wiki_synced'})
            finally:
                with _wiki_sync_lock:
                    _wiki_sync_pending = False
        elif content_type == "raw" and event_type in ('created', 'modified'):
            await _handle_file_upsert(db, file_path, project_name, websockets)
        elif content_type == "raw" and event_type == 'deleted':
            _handle_file_deleted(db, file_path, project_name, websockets)
    except Exception as e:
        logger.error(f"Error handling file change: {e}")
    finally:
        db.close()


async def _handle_file_upsert(
    db: Session,
    file_path: str,
    project_name: str,
    websockets: List
) -> None:
    """Create or update a node from a markdown file."""
    # Read file content
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        logger.error(f"Error reading file {file_path}: {e}")
        return

    # Handle empty files
    if not content.strip():
        logger.warning(f"Skipping empty file: {file_path}")
        return

    # Parse markdown
    frontmatter, sections, title = parse_markdown(content)

    # Extract node data
    node_id = _safe_get_node_id(file_path, frontmatter)
    parent_id = _normalize_parent_id(frontmatter.get('parent_id'))
    question = sections.get('Question', title or '')
    answer = sections.get('Answer', sections.get('Content', ''))
    summary = sections.get('Summary', '')
    context = sections.get('Context', '')

    # Skip if content is not meaningful
    if not _is_valid_content(question, answer):
        logger.warning(f"Skipping file with no meaningful content: {file_path}")
        return

    # Validate parent exists if specified
    if parent_id:
        parent_node = db.query(Node).filter(Node.id == parent_id).first()
        if not parent_node:
            logger.warning(f"Parent node not found: {parent_id}, treating as root")
            parent_id = None

    # Get or create project
    project = db.query(Project).filter(Project.title == project_name).first()
    if not project:
        import uuid
        project = Project(
            id=str(uuid.uuid4()),
            title=project_name,
            node_count=0,
            is_favorite=False,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        logger.info(f"Created project: {project_name}")

    # Check if node already exists in this project
    existing_node = db.query(Node).filter(
        Node.id == node_id,
        Node.project_id == project.id
    ).first()
    
    # Check if node exists in another project
    node_in_other_project = None
    if not existing_node:
        node_in_other_project = db.query(Node).filter(
            Node.id == node_id,
            Node.project_id != project.id
        ).first()
        
        if node_in_other_project:
            logger.warning(f"Node {node_id} exists in another project, generating new ID")
            import uuid as uuid_module
            node_id = f"{node_id}-{uuid_module.uuid4().hex[:6]}"
    
    now = datetime.now(timezone.utc)

    if existing_node:
        # Update existing node
        old_parent_id = existing_node.parent_id
        existing_node.question = question
        existing_node.answer = answer
        existing_node.summary = summary
        existing_node.context = context
        existing_node.parent_id = parent_id
        existing_node.node_type = 'branch' if parent_id else 'root'
        existing_node.updated_at = now

        # Handle parent change
        if old_parent_id != parent_id:
            _update_node_children_count(db, old_parent_id)
            _update_node_children_count(db, parent_id)
            # Remove old edge
            db.query(Edge).filter(
                Edge.project_id == project.id,
                Edge.source == old_parent_id,
                Edge.target == node_id,
            ).delete()
            # Create new edge if needed
            if parent_id:
                _ensure_edge_exists(db, project.id, parent_id, node_id)

        logger.info(f"Updated node: {node_id}")
    else:
        # Create new node
        new_node = Node(
            id=node_id,
            project_id=project.id,
            parent_id=parent_id,
            node_type='branch' if parent_id else 'root',
            question=question,
            answer=answer,
            summary=summary,
            context=context,
            is_marked=False,
            is_branch_collapsed=False,
            is_node_collapsed=False,
            children_count=0,
            position_x=96,
            position_y=120,
            width=290,
            height=380,
        )
        savepoint = db.begin_nested()
        try:
            db.add(new_node)
            _update_node_children_count(db, parent_id)

            # Create edge if parent exists
            if parent_id:
                _ensure_edge_exists(db, project.id, parent_id, node_id)

            _update_project_node_counts(db, project.id)
            savepoint.commit()
            logger.info(f"Created node: {node_id}")
        except IntegrityError:
            savepoint.rollback()
            # Node was created concurrently, update it instead
            existing = db.query(Node).filter(Node.id == node_id).first()
            if existing:
                existing.question = question
                existing.answer = answer
                existing.summary = summary
                existing.context = context
                existing.parent_id = parent_id
                existing.node_type = 'branch' if parent_id else 'root'
                existing.updated_at = now
                logger.info(f"Node {node_id} already exists, updated instead")
            else:
                logger.error(f"IntegrityError for node {node_id} but node not found after rollback")
                raise

    db.commit()

    # Broadcast change
    _broadcast(websockets, {
        'type': 'node_updated',
        'projectId': project.id,
        'nodeId': node_id,
        'projectName': project_name,
    })


def _ensure_edge_exists(db: Session, project_id: str, source: str, target: str) -> None:
    """Create an edge if it doesn't already exist."""
    existing = db.query(Edge).filter(
        Edge.project_id == project_id,
        Edge.source == source,
        Edge.target == target,
    ).first()
    if not existing:
        edge = Edge(
            id=f"{source}-{target}",
            project_id=project_id,
            source=source,
            target=target,
        )
        db.add(edge)


def _handle_file_deleted(
    db: Session,
    file_path: str,
    project_name: str,
    websockets: List
) -> None:
    """Handle file deletion."""
    project = db.query(Project).filter(Project.title == project_name).first()
    if not project:
        logger.warning(f"Project not found: {project_name}")
        return

    # Find node by filename
    filename = os.path.basename(file_path)
    node_id = filename.replace('.md', '')

    # Try to find the node
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        # Try matching by expected filename pattern
        all_nodes = db.query(Node).filter(Node.project_id == project.id).all()
        for n in all_nodes:
            ts = n.created_at.strftime('%Y%m%d%H%M%S') if n.created_at else ''
            safe_title = re.sub(r'[<>:"/\\|?*]', '', n.question or 'node')[:30]
            expected = f"{ts}-{safe_title}"
            if node_id == expected:
                node = n
                break

    if not node:
        logger.warning(f"Node not found for deleted file: {file_path}")
        return

    # Delete node and descendants
    descendant_ids = _collect_descendant_ids(db, project.id, node.id)
    db.query(Edge).filter(
        Edge.project_id == project.id,
        (Edge.source.in_(descendant_ids)) | (Edge.target.in_(descendant_ids)),
    ).delete(synchronize_session=False)
    db.query(Node).filter(
        Node.project_id == project.id,
        Node.id.in_(descendant_ids),
    ).delete(synchronize_session=False)

    # Update parent's children count
    _update_node_children_count(db, node.parent_id)
    _update_project_node_counts(db, project.id)
    db.commit()

    logger.info(f"Deleted nodes: {descendant_ids}")
    _broadcast(websockets, {
        'type': 'node_deleted',
        'projectId': project.id,
        'nodeId': node.id,
        'nodeIds': descendant_ids,
        'projectName': project_name,
    })
