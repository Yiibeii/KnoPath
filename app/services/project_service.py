from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from models import Project, Node, Edge
from schemas import ProjectBase, NodeBase, NodeDataBase
from services.file_storage import save_project_files, delete_node_file, sanitize_filename
from logger import get_logger
from config import get_storage_path
from datetime import datetime, timezone
import os
import shutil
import uuid

logger = get_logger('project_service')


def _parse_optional_datetime(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _collect_descendant_ids(db: Session, project_id: str, node_id: str) -> list[str]:
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


def _update_all_children_counts(db: Session, project_id: str) -> None:
    nodes = db.query(Node).filter(Node.project_id == project_id).all()
    for node in nodes:
        node.children_count = db.query(Node).filter(
            Node.project_id == project_id,
            Node.parent_id == node.id,
        ).count()


def project_to_schema(project: Project) -> ProjectBase:
    nodes = []
    for node in project.nodes:
        nodes.append(NodeBase(
            id=node.id,
            type="knopath",
            position={"x": node.position_x, "y": node.position_y},
            width=node.width,
            height=node.height,
            data=NodeDataBase(
                parentId=node.parent_id,
                type=node.node_type,
                question=node.question,
                answer=node.answer,
                summary=node.summary,
                context=node.context,
                isMarked=node.is_marked,
                isBranchCollapsed=node.is_branch_collapsed,
                isNodeCollapsed=node.is_node_collapsed,
                childrenCount=node.children_count,
                createdAt=node.created_at.isoformat() if node.created_at else None,
                updatedAt=node.updated_at.isoformat() if node.updated_at else None,
                insightUpdatedAt=node.insight_updated_at.isoformat() if node.insight_updated_at else None,
                exploration=node.exploration,
            )
        ))

    edges = []
    for edge in project.edges:
        edges.append({"id": edge.id, "source": edge.source, "target": edge.target})

    return ProjectBase(
        id=project.id,
        title=project.title,
        nodes=nodes,
        edges=edges,
        nodeCount=project.node_count,
        isFavorite=project.is_favorite,
        createdAt=project.created_at.isoformat() if project.created_at else None,
        updatedAt=project.updated_at.isoformat() if project.updated_at else None,
    )


def get_project_by_id(db: Session, project_id: str) -> Project:
    return db.query(Project).filter(Project.id == project_id).first()


def get_all_projects(db: Session):
    return db.query(Project).order_by(Project.updated_at.desc()).all()


def create_project(db: Session, title: str) -> Project:
    project = Project(
        id=str(uuid.uuid4()),
        title=title,
        node_count=0,
        is_favorite=False,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    logger.info(f"Project created with id: {project.id}")
    return project


def update_project(db: Session, project_id: str, title: str = None, is_favorite: bool = None) -> Project:
    project = get_project_by_id(db, project_id)
    if not project:
        return None
    
    old_title = project.title
    
    if title is not None and title != old_title:
        storage_path = get_storage_path()
        
        old_raw_dir = os.path.join(storage_path, "raw", sanitize_filename(old_title))
        new_raw_dir = os.path.join(storage_path, "raw", sanitize_filename(title))
        
        if os.path.exists(old_raw_dir) and old_raw_dir != new_raw_dir:
            if os.path.exists(new_raw_dir):
                logger.warning(f"Target raw directory already exists: {new_raw_dir}")
            else:
                try:
                    os.rename(old_raw_dir, new_raw_dir)
                    logger.info(f"Renamed raw project directory: {old_raw_dir} -> {new_raw_dir}")
                except OSError as e:
                    logger.error(f"Failed to rename raw project directory: {e}")
        
        old_wiki_dir = os.path.join(storage_path, "wiki", sanitize_filename(old_title))
        new_wiki_dir = os.path.join(storage_path, "wiki", sanitize_filename(title))
        
        if os.path.exists(old_wiki_dir) and old_wiki_dir != new_wiki_dir:
            if os.path.exists(new_wiki_dir):
                logger.warning(f"Target wiki directory already exists: {new_wiki_dir}")
            else:
                try:
                    os.rename(old_wiki_dir, new_wiki_dir)
                    logger.info(f"Renamed wiki project directory: {old_wiki_dir} -> {new_wiki_dir}")
                except OSError as e:
                    logger.error(f"Failed to rename wiki project directory: {e}")
        
        project.title = title
    
    if is_favorite is not None:
        project.is_favorite = is_favorite
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    logger.info(f"Project updated: {project_id}")
    return project


def delete_project(db: Session, project_id: str) -> bool:
    project = get_project_by_id(db, project_id)
    if not project:
        return False
    storage_path = get_storage_path()
    project_dir = os.path.join(storage_path, "raw", sanitize_filename(project.title))
    db.delete(project)
    db.commit()
    if os.path.exists(project_dir):
        shutil.rmtree(project_dir)
        logger.info(f"Deleted project directory: {project_dir}")
    logger.info(f"Project deleted: {project_id}")
    return True


async def save_full_project(db: Session, project_data: ProjectBase) -> dict:
    logger.info(f"Saving project: {project_data.id} - {project_data.title}")

    project = db.query(Project).filter(Project.id == project_data.id).first()
    if not project:
        logger.debug(f"Creating new project in database: {project_data.id}")
        project = Project(
            id=project_data.id,
            title=project_data.title,
        )
        db.add(project)
        db.flush()
    else:
        project.title = project_data.title
        project.is_favorite = project_data.isFavorite

    incoming_node_ids = {node.id for node in project_data.nodes}

    existing_nodes = db.query(Node).filter(Node.project_id == project.id).all()
    existing_node_map = {n.id: n for n in existing_nodes}

    nodes_to_remove = [nid for nid in existing_node_map if nid not in incoming_node_ids]
    if nodes_to_remove:
        db.query(Edge).filter(
            Edge.project_id == project.id,
            (Edge.source.in_(nodes_to_remove)) | (Edge.target.in_(nodes_to_remove)),
        ).delete(synchronize_session=False)
        db.query(Node).filter(
            Node.project_id == project.id,
            Node.id.in_(nodes_to_remove),
        ).delete(synchronize_session=False)
        logger.debug(f"Removed {len(nodes_to_remove)} nodes no longer in project")

    conflicting_ids = set()
    if project_data.nodes:
        node_ids = [node.id for node in project_data.nodes]
        existing = db.query(Node.id).filter(Node.id.in_(node_ids), Node.project_id != project.id).all()
        conflicting_ids = {row[0] for row in existing}

    logger.debug(f"Saving {len(project_data.nodes)} nodes")
    for node in project_data.nodes:
        node_id = node.id
        if node_id in conflicting_ids:
            new_id = f"{node_id}-{uuid.uuid4().hex[:6]}"
            logger.warning(f"Node ID conflict: {node_id} exists in another project, reassigned to {new_id}")
            node_id = new_id

        existing_node = existing_node_map.get(node.id)
        if existing_node:
            existing_node.parent_id = node.data.parentId
            existing_node.node_type = node.data.type
            existing_node.question = node.data.question
            existing_node.answer = node.data.answer
            existing_node.summary = node.data.summary
            existing_node.context = node.data.context
            existing_node.is_marked = node.data.isMarked
            existing_node.is_branch_collapsed = node.data.isBranchCollapsed
            existing_node.is_node_collapsed = node.data.isNodeCollapsed
            existing_node.children_count = node.data.childrenCount
            existing_node.position_x = node.position.get("x", 96)
            existing_node.position_y = node.position.get("y", 120)
            existing_node.width = node.width
            existing_node.height = node.height
            existing_node.updated_at = _parse_optional_datetime(node.data.updatedAt) or datetime.now(timezone.utc)
            if node.data.insightUpdatedAt:
                existing_node.insight_updated_at = _parse_optional_datetime(node.data.insightUpdatedAt)
            if node.data.exploration:
                existing_node.exploration = node.data.exploration.model_dump()
        else:
            db_node = Node(
                id=node_id,
                project_id=project.id,
                parent_id=node.data.parentId,
                node_type=node.data.type,
                question=node.data.question,
                answer=node.data.answer,
                summary=node.data.summary,
                context=node.data.context,
                is_marked=node.data.isMarked,
                is_branch_collapsed=node.data.isBranchCollapsed,
                is_node_collapsed=node.data.isNodeCollapsed,
                children_count=node.data.childrenCount,
                position_x=node.position.get("x", 96),
                position_y=node.position.get("y", 120),
                width=node.width,
                height=node.height,
                created_at=_parse_optional_datetime(node.data.createdAt) or datetime.now(timezone.utc),
                updated_at=_parse_optional_datetime(node.data.updatedAt) or datetime.now(timezone.utc),
                insight_updated_at=_parse_optional_datetime(node.data.insightUpdatedAt),
                exploration=node.data.exploration.model_dump() if node.data.exploration else None,
            )
            try:
                db.add(db_node)
            except IntegrityError:
                db.rollback()
                conflict = db.query(Node).filter(Node.id == node_id).first()
                if conflict:
                    conflict.parent_id = node.data.parentId
                    conflict.node_type = node.data.type
                    conflict.question = node.data.question
                    conflict.answer = node.data.answer
                    conflict.summary = node.data.summary
                    conflict.context = node.data.context
                    conflict.is_marked = node.data.isMarked
                    conflict.is_branch_collapsed = node.data.isBranchCollapsed
                    conflict.is_node_collapsed = node.data.isNodeCollapsed
                    conflict.children_count = node.data.childrenCount
                    conflict.position_x = node.position.get("x", 96)
                    conflict.position_y = node.position.get("y", 120)
                    conflict.width = node.width
                    conflict.height = node.height
                    conflict.updated_at = _parse_optional_datetime(node.data.updatedAt) or datetime.now(timezone.utc)
                    if node.data.insightUpdatedAt:
                        conflict.insight_updated_at = _parse_optional_datetime(node.data.insightUpdatedAt)
                    if node.data.exploration:
                        conflict.exploration = node.data.exploration.model_dump()
                    logger.warning(f"Node {node_id} already exists (race condition), updated instead")
                else:
                    raise

    incoming_edge_ids = {edge.id for edge in project_data.edges}
    existing_edges = db.query(Edge).filter(Edge.project_id == project.id).all()
    existing_edge_map = {e.id: e for e in existing_edges}

    edges_to_remove = [eid for eid in existing_edge_map if eid not in incoming_edge_ids]
    if edges_to_remove:
        db.query(Edge).filter(
            Edge.project_id == project.id,
            Edge.id.in_(edges_to_remove),
        ).delete(synchronize_session=False)

    for edge in project_data.edges:
        if edge.id not in existing_edge_map:
            db_edge = Edge(
                id=edge.id,
                project_id=project.id,
                source=edge.source,
                target=edge.target,
            )
            db.add(db_edge)

    project.node_count = len(project_data.nodes)
    project.updated_at = datetime.now(timezone.utc)

    from file_watcher import get_file_watcher
    watcher = get_file_watcher()

    saved_files = await save_project_files(project_data, get_storage_path())

    if watcher:
        watcher.add_cooldown_batch(saved_files)

    try:
        db.commit()
        logger.debug("Database commit successful")
    except Exception as e:
        db.rollback()
        logger.error(f"Database commit failed: {e}")
        for f in saved_files:
            try:
                if os.path.exists(f):
                    os.remove(f)
            except OSError:
                pass
        raise

    logger.info(f"Project saved: {len(project_data.nodes)} nodes, {len(saved_files)} files")

    return {
        "message": "Project saved successfully",
        "nodeCount": len(project_data.nodes),
        "filesSaved": len(saved_files),
    }


async def remove_node(db: Session, project_id: str, node_id: str) -> dict:
    logger.info(f"[DELETE] Removing node: {node_id} from project: {project_id}")

    project = get_project_by_id(db, project_id)
    if not project:
        logger.warning(f"[DELETE] Project not found: {project_id}")
        return None

    node = db.query(Node).filter(Node.id == node_id, Node.project_id == project_id).first()
    if not node:
        logger.warning(f"[DELETE] Node not found: {node_id}")
        return None

    deleted_node_ids = _collect_descendant_ids(db, project_id, node_id)
    nodes_to_delete = db.query(Node).filter(
        Node.project_id == project_id,
        Node.id.in_(deleted_node_ids),
    ).all()

    from file_watcher import get_file_watcher
    watcher = get_file_watcher()

    deleted_files = []
    for node_to_delete in nodes_to_delete:
        deleted_file = await delete_node_file(node_to_delete, project.title, get_storage_path())
        if deleted_file:
            deleted_files.append(deleted_file)
            if watcher:
                watcher.add_cooldown(deleted_file)

    db.query(Edge).filter(
        Edge.project_id == project_id,
        (Edge.source.in_(deleted_node_ids)) | (Edge.target.in_(deleted_node_ids)),
    ).delete(synchronize_session=False)

    db.query(Node).filter(
        Node.project_id == project_id,
        Node.id.in_(deleted_node_ids),
    ).delete(synchronize_session=False)

    _update_all_children_counts(db, project_id)
    project.node_count = db.query(Node).filter(Node.project_id == project.id).count()
    project.updated_at = datetime.now(timezone.utc)
    db.commit()

    logger.info(f"[DELETE] Nodes deleted from database: {deleted_node_ids}")

    return {
        "message": "Node deleted",
        "deletedFiles": deleted_files,
        "deletedNodeIds": deleted_node_ids,
    }
