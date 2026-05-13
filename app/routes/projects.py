from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from database import get_db
from schemas import (
    ProjectBase, ProjectCreate, ProjectUpdate,
    ProjectFilesResponse, SaveRequest, ImportJsonRequest,
)
from services.project_service import (
    project_to_schema,
    get_project_by_id,
    get_all_projects,
    create_project as create_project_svc,
    update_project as update_project_svc,
    delete_project as delete_project_svc,
    save_full_project,
)
from services.file_storage import read_project_files, parse_node_from_markdown, sanitize_filename, format_timestamp, build_node_content
from logger import get_logger
from config import get_storage_path
from models import Project, Node, Edge
import uuid
import os
import json as json_mod

logger = get_logger('routes.projects')
router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=List[ProjectBase])
def list_projects(db: Session = Depends(get_db)):
    logger.debug("Fetching all projects")
    projects = get_all_projects(db)
    logger.info(f"Retrieved {len(projects)} projects")
    return [project_to_schema(p) for p in projects]


@router.post("/projects", response_model=ProjectBase)
def create_project(project_data: ProjectCreate, db: Session = Depends(get_db)):
    logger.info(f"Creating new project: {project_data.title}")
    project = create_project_svc(db, project_data.title)
    return project_to_schema(project)


@router.get("/projects/{project_id}", response_model=ProjectBase)
def get_project(project_id: str, db: Session = Depends(get_db)):
    logger.debug(f"Fetching project: {project_id}")
    project = get_project_by_id(db, project_id)
    logger.debug(f"Retrieved project: {project}")
    if not project:
        logger.warning(f"Project not found: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    return project_to_schema(project)


@router.put("/projects/{project_id}", response_model=ProjectBase)
def update_project(
    project_id: str,
    project_data: ProjectUpdate,
    db: Session = Depends(get_db)
):
    logger.info(f"Updating project: {project_id}")
    project = update_project_svc(
        db, project_id,
        title=project_data.title,
        is_favorite=project_data.isFavorite,
    )
    if not project:
        logger.warning(f"Project not found for update: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    return project_to_schema(project)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    logger.info(f"Deleting project: {project_id}")
    if not delete_project_svc(db, project_id):
        logger.warning(f"Project not found for deletion: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    return {"message": "Project deleted"}


@router.post("/projects/save")
async def save_project(request: SaveRequest, db: Session = Depends(get_db)):
    result = await save_full_project(db, request.project)
    return result


@router.get("/projects/{project_id}/files", response_model=ProjectFilesResponse)
async def get_project_files(project_id: str, db: Session = Depends(get_db)):
    project = get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_dir = os.path.join(get_storage_path(), "raw", project.title)
    files = await read_project_files(project_dir)

    return ProjectFilesResponse(
        projectId=project.id,
        projectTitle=project.title,
        files=files,
    )


@router.post("/projects/import", response_model=List[ProjectBase])
async def import_project_from_files(db: Session = Depends(get_db)):
    raw_dir = os.path.join(get_storage_path(), "raw")

    if not os.path.exists(raw_dir):
        db.query(Edge).delete(synchronize_session=False)
        db.query(Node).delete(synchronize_session=False)
        db.query(Project).delete(synchronize_session=False)
        db.commit()
        return []

    local_projects: dict[str, list[dict]] = {}

    for project_name in os.listdir(raw_dir):
        project_path = os.path.join(raw_dir, project_name)
        if not os.path.isdir(project_path):
            continue

        nodes_data = []
        seen_node_ids = set()
        for filename in os.listdir(project_path):
            if not filename.endswith('.md'):
                continue

            filepath = os.path.join(project_path, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            node_data = parse_node_from_markdown(content)
            if node_data and node_data.get('id'):
                node_id = node_data['id']
                if node_id not in seen_node_ids:
                    nodes_data.append(node_data)
                    seen_node_ids.add(node_id)

        if nodes_data:
            local_projects[project_name] = nodes_data

    if not local_projects:
        db.query(Edge).delete(synchronize_session=False)
        db.query(Node).delete(synchronize_session=False)
        db.query(Project).delete(synchronize_session=False)
        db.commit()
        return []

    local_project_names = set(local_projects)
    stale_projects = db.query(Project).filter(~Project.title.in_(local_project_names)).all()
    for project in stale_projects:
        db.delete(project)

    imported_projects = []

    for project_name, nodes_data in local_projects.items():
        existing_project = db.query(Project).filter(Project.title == project_name).first()
        if existing_project:
            project = existing_project
        else:
            project = Project(
                id=str(uuid.uuid4()),
                title=project_name,
            )
            db.add(project)
            db.flush()

        local_node_ids = {node_data['id'] for node_data in nodes_data}

        existing_nodes = db.query(Node).filter(Node.project_id == project.id).all()
        existing_node_map = {n.id: n for n in existing_nodes}

        nodes_to_remove = [nid for nid in existing_node_map if nid not in local_node_ids]
        if nodes_to_remove:
            db.query(Edge).filter(
                Edge.project_id == project.id,
                (Edge.source.in_(nodes_to_remove)) | (Edge.target.in_(nodes_to_remove)),
            ).delete(synchronize_session=False)
            db.query(Node).filter(
                Node.project_id == project.id,
                Node.id.in_(nodes_to_remove),
            ).delete(synchronize_session=False)

        conflicting_ids = set()
        if local_node_ids:
            existing = db.query(Node.id).filter(Node.id.in_(local_node_ids), Node.project_id != project.id).all()
            conflicting_ids = {row[0] for row in existing}

        for node_data in nodes_data:
            node_id = node_data['id']
            if node_id in conflicting_ids:
                new_id = f"{node_id}-{uuid.uuid4().hex[:6]}"
                logger.warning(f"Node ID conflict on import: {node_id} exists in another project, reassigned to {new_id}")
                node_id = new_id

            existing_node = existing_node_map.get(node_data['id'])

            if existing_node:
                existing_node.question = node_data.get('question') or existing_node.question
                existing_node.answer = node_data.get('answer') or existing_node.answer
                existing_node.summary = node_data.get('summary') or existing_node.summary
                existing_node.context = node_data.get('context') or existing_node.context
                existing_node.parent_id = node_data.get('parentId')
                existing_node.node_type = 'branch' if node_data.get('parentId') else 'root'
            else:
                db_node = Node(
                    id=node_id,
                    project_id=project.id,
                    parent_id=node_data.get('parentId'),
                    node_type='branch' if node_data.get('parentId') else 'root',
                    question=node_data.get('question'),
                    answer=node_data.get('answer'),
                    summary=node_data.get('summary'),
                    context=node_data.get('context'),
                )
                db.add(db_node)

            if node_data.get('parentId') and node_data.get('parentId') in local_node_ids:
                edge_id = f"{node_data['parentId']}-{node_id}"
                existing_edge = db.query(Edge).filter(Edge.id == edge_id).first()
                if not existing_edge:
                    edge = Edge(
                        id=edge_id,
                        project_id=project.id,
                        source=node_data['parentId'],
                        target=node_id,
                    )
                    db.add(edge)

        project.node_count = db.query(Node).filter(Node.project_id == project.id).count()
        imported_projects.append(project)

    db.commit()
    for project in imported_projects:
        db.refresh(project)

    return [project_to_schema(p) for p in imported_projects]


def _extract_summary(answer: str) -> str:
    """Extract first paragraph from answer as summary."""
    if not answer:
        return ''
    parts = answer.strip().split('\n\n')
    for part in parts:
        text = part.strip()
        if text:
            return text
    return ''


def _parse_simple_qa(items: list[dict]) -> list[dict]:
    nodes = []
    current_question = ''
    for item in items:
        user_text = item.get('user', '').strip()
        assistant_text = item.get('assistant', '').strip()
        branches = item.get('branches', [])
        
        if user_text:
            if current_question and not assistant_text:
                nodes.append({
                    'question': current_question,
                    'answer': '',
                    'summary': '',
                    'context': '',
                })
            current_question = user_text
        if assistant_text:
            if current_question:
                node_data = {
                    'question': current_question,
                    'answer': assistant_text,
                    'summary': _extract_summary(assistant_text),
                    'context': '',
                }
                if branches:
                    node_data['branches'] = branches
                nodes.append(node_data)
                current_question = ''
            else:
                node_data = {
                    'question': 'Untitled',
                    'answer': assistant_text,
                    'summary': _extract_summary(assistant_text),
                    'context': '',
                }
                if branches:
                    node_data['branches'] = branches
                nodes.append(node_data)
    if current_question:
        nodes.append({
            'question': current_question,
            'answer': '',
            'summary': '',
            'context': '',
        })
    return nodes


def _parse_knopath_format(data: dict) -> list[dict]:
    nodes = []
    raw_nodes = data.get('nodes', [])
    for raw in raw_nodes:
        question = raw.get('question', '').strip()
        answer = raw.get('answer', '').strip()

        branches_raw = raw.get('branches', [])
        branches = [
            {
                'question': b.get('question', '').strip(),
                'answer': b.get('answer', '').strip(),
            }
            for b in branches_raw
            if b.get('question') or b.get('answer')
        ]

        if not question and not answer and not branches:
            continue

        node_data = {
            'question': question or 'Untitled',
            'answer': answer,
            'summary': _extract_summary(answer),
            'context': '',
        }
        if branches:
            node_data['branches'] = branches
        nodes.append(node_data)
    return nodes


def _parse_conversations_format(data: dict) -> list[dict]:
    nodes = []
    conversations = data.get('conversations', [])
    
    for conv in conversations:
        question = conv.get('question', '').strip()
        answer = conv.get('answer', '').strip()
        branches = conv.get('branches', [])
        
        if question or answer:
            node_data = {
                'question': question or 'Untitled',
                'answer': answer,
                'summary': _extract_summary(answer),
                'context': '',
            }
            if branches:
                node_data['branches'] = [
                    {
                        'question': b.get('question', '').strip(),
                        'answer': b.get('answer', '').strip(),
                    }
                    for b in branches
                    if b.get('question') or b.get('answer')
                ]
            nodes.append(node_data)

    return nodes


def _parse_chat_export(items: list[dict]) -> list[dict]:
    nodes = []
    for item in items:
        title = item.get('title', '').strip()
        history = item.get('chat', {}).get('history', {})
        history_messages = history.get('messages', {})
        if not history_messages:
            continue

        # Check if this is Qwen format (has messages array + parentId/childrenIds)
        msg_array = item.get('messages', [])
        has_tree = any('parentId' in m or 'childrenIds' in m for m in msg_array)

        if has_tree and msg_array:
            nodes.extend(_parse_qwen_tree(msg_array, history_messages, title))
        else:
            nodes.extend(_parse_flat_chat(history_messages))

    return nodes


def _extract_msg_content(msg: dict) -> str:
    """Extract text content from a message, preferring answer phase over thinking."""
    content_list = msg.get('content_list', [])
    if content_list:
        # Priority: answer phase > non-thinking phase > first non-empty
        answer_text = ''
        fallback_text = ''
        for part in content_list:
            phase = part.get('phase', '')
            text = (part.get('content') or '').strip()
            if not text:
                continue
            if phase == 'answer':
                answer_text = text
                break
            if phase in (None, '', 'thinking_summary') and not fallback_text:
                fallback_text = text
        if answer_text:
            return answer_text
        if fallback_text:
            return fallback_text
    return (msg.get('content') or '').strip()


def _parse_qwen_tree(msg_array: list, history_messages: dict, title: str) -> list[dict]:
    """Parse Qwen export with parentId/childrenIds tree structure."""
    # Build lookup: id -> message (merge array + history)
    msg_map = {}
    for m in msg_array:
        mid = m.get('id', '')
        if mid:
            msg_map[mid] = m
    for mid, m in history_messages.items():
        if mid not in msg_map:
            msg_map[mid] = m

    # Find root messages (no parentId)
    roots = [m for m in msg_array if not m.get('parentId')]

    def build_node(msg):
        mid = msg.get('id', '')
        role = msg.get('role', '')
        content = _extract_msg_content(msg)

        if role == 'user':
            children_ids = msg.get('childrenIds', [])
            children = [msg_map[cid] for cid in children_ids if cid in msg_map]

            if len(children) == 0:
                return {'question': content, 'answer': '', 'summary': _extract_summary(content), 'context': ''}
            elif len(children) == 1:
                child_node = build_node(children[0])
                return {'question': content, 'answer': child_node.get('answer', ''),
                        'summary': _extract_summary(child_node.get('answer', '')), 'context': ''}
            else:
                # Multiple branches
                branches = []
                main_answer = ''
                for child in children:
                    child_node = build_node(child)
                    branches.append({'question': content, 'answer': child_node.get('answer', '')})
                    if not main_answer and child_node.get('answer'):
                        main_answer = child_node['answer']
                return {'question': content, 'answer': main_answer,
                        'summary': _extract_summary(main_answer), 'context': '',
                        'branches': branches}
        elif role == 'assistant':
            # Follow the active branch
            children_ids = msg.get('childrenIds', [])
            if children_ids:
                next_msg = msg_map.get(children_ids[0])
                if next_msg and next_msg.get('role') == 'user':
                    next_node = build_node(next_msg)
                    return {'question': next_node.get('question', ''), 'answer': content,
                            'summary': _extract_summary(content), 'context': ''}
            return {'question': '', 'answer': content, 'summary': _extract_summary(content), 'context': ''}
        return None

    for root in roots:
        node = build_node(root)
        if node and node.get('question'):
            nodes.append(node)

    if not nodes and title:
        nodes.append({'question': title, 'answer': '', 'summary': '', 'context': ''})

    return nodes


def _parse_flat_chat(messages: dict) -> list[dict]:
    """Parse flat chat export (sorted by key, no tree structure)."""
    sorted_ids = sorted(messages.keys())
    qa_pairs = []
    current_question = ''
    current_answer = ''

    for msg_id in sorted_ids:
        msg = messages[msg_id]
        role = msg.get('role', '')
        content = _extract_msg_content(msg)

        if role == 'user' and content:
            if current_question and current_answer:
                qa_pairs.append({'question': current_question, 'answer': current_answer})
            current_question = content
            current_answer = ''
        elif role == 'assistant' and content:
            current_answer = content

    if current_question and current_answer:
        qa_pairs.append({'question': current_question, 'answer': current_answer})

    nodes = []
    for pair in qa_pairs:
        nodes.append({
            'question': pair['question'],
            'answer': pair['answer'],
            'summary': _extract_summary(pair['answer']),
            'context': '',
        })
    return nodes


def _detect_format(items) -> str:
    if not items:
        return 'simple'
    if isinstance(items, dict):
        if 'conversations' in items:
            return 'conversations'
        if 'nodes' in items and isinstance(items['nodes'], list):
            return 'knopath'
        return 'simple'
    first = items[0] if items else {}
    if isinstance(first, dict):
        if 'nodes' in first and isinstance(first['nodes'], list):
            return 'knopath'
        if 'chat' in first and isinstance(first.get('chat'), dict):
            return 'chat_export'
        if 'conversations' in first:
            return 'conversations'
        if 'user' in first or 'assistant' in first:
            return 'simple'
    return 'simple'


@router.post("/projects/import-json", response_model=ProjectBase)
async def import_project_from_json(request: ImportJsonRequest, db: Session = Depends(get_db)):
    title = request.title.strip() or 'Imported Project'
    items = request.jsonData

    if not items:
        raise HTTPException(status_code=400, detail="jsonData must not be empty")

    fmt = _detect_format(items)
    if fmt == 'knopath':
        if isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict) and 'nodes' in items[0]:
            nodes_data = _parse_knopath_format(items[0])
        else:
            nodes_data = _parse_knopath_format(items)
    elif fmt == 'conversations':
        nodes_data = _parse_conversations_format(items)
    elif fmt == 'chat_export':
        nodes_data = _parse_chat_export(items)
    else:
        nodes_data = _parse_simple_qa(items)

    if not nodes_data:
        raise HTTPException(status_code=400, detail="No valid Q&A pairs found in JSON data")

    project = Project(
        id=str(uuid.uuid4()),
        title=title,
    )
    db.add(project)
    db.flush()

    now_str = format_timestamp()
    created_nodes = []
    parent_id = None

    node_id_map = {}

    for i, nd in enumerate(nodes_data):
        node_id = str(uuid.uuid4())
        node_type = 'root' if i == 0 else 'branch'
        pid = None if i == 0 else parent_id

        db_node = Node(
            id=node_id,
            project_id=project.id,
            parent_id=pid,
            node_type=node_type,
            question=nd['question'],
            answer=nd['answer'],
            summary=nd.get('summary', ''),
            context=nd.get('context', ''),
        )
        db.add(db_node)
        created_nodes.append(db_node)
        node_id_map[i] = node_id
        parent_id = node_id

    branch_edges = []
    for i, nd in enumerate(nodes_data):
        node_id = node_id_map[i]
        branches = nd.get('branches', [])
        for branch in branches:
            branch_answer = branch.get('answer', '')
            branch_node = Node(
                id=str(uuid.uuid4()),
                project_id=project.id,
                parent_id=node_id,
                node_type='branch',
                question=branch.get('question', ''),
                answer=branch_answer,
                summary=_extract_summary(branch_answer),
                context='',
            )
            db.add(branch_node)
            created_nodes.append(branch_node)
            branch_edges.append((node_id, branch_node.id))

    for i in range(1, len(nodes_data)):
        src = node_id_map[i - 1]
        tgt = node_id_map[i]
        edge_id = f"{src}-{tgt}"
        edge = Edge(
            id=edge_id,
            project_id=project.id,
            source=src,
            target=tgt,
        )
        db.add(edge)

    for src, tgt in branch_edges:
        edge_id = f"{src}-{tgt}"
        edge = Edge(
            id=edge_id,
            project_id=project.id,
            source=src,
            target=tgt,
        )
        db.add(edge)

    project.node_count = len(created_nodes)
    db.commit()
    db.refresh(project)

    from schemas import NodeBase, NodeDataBase
    from datetime import datetime, timezone

    project_base = ProjectBase(
        id=project.id,
        title=project.title,
        nodes=[
            NodeBase(
                id=n.id,
                type="knopath",
                position={"x": 96, "y": 120},
                width=290,
                height=380,
                data=NodeDataBase(
                    parentId=n.parent_id,
                    type=n.node_type,
                    question=n.question,
                    answer=n.answer,
                    summary=n.summary or '',
                    context=n.context or '',
                    childrenCount=0,
                    createdAt=n.created_at.isoformat() if n.created_at else None,
                    updatedAt=n.updated_at.isoformat() if n.updated_at else None,
                ),
            )
            for n in created_nodes
        ],
        edges=[
            {"id": f"{node_id_map[i-1]}-{node_id_map[i]}", "source": node_id_map[i-1], "target": node_id_map[i]}
            for i in range(1, len(nodes_data))
        ] + [
            {"id": f"{src}-{tgt}", "source": src, "target": tgt}
            for src, tgt in branch_edges
        ],
        nodeCount=len(created_nodes),
        isFavorite=False,
        createdAt=project.created_at.isoformat() if project.created_at else None,
        updatedAt=project.updated_at.isoformat() if project.updated_at else None,
    )

    from services.file_storage import save_project_files
    from file_watcher import get_file_watcher

    saved_files = await save_project_files(project_base, get_storage_path())
    watcher = get_file_watcher()
    if watcher:
        watcher.add_cooldown_batch(saved_files)

    logger.info(f"Imported project from JSON: {title} with {len(created_nodes)} nodes")
    return project_to_schema(project)
