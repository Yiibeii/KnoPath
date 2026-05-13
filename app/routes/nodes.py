from fastapi import APIRouter, Depends, HTTPException
from database import get_db
from sqlalchemy.orm import Session
from services.project_service import remove_node, get_project_by_id
from logger import get_logger

logger = get_logger('routes.nodes')
router = APIRouter(tags=["nodes"])


@router.delete("/projects/{project_id}/nodes/{node_id}")
async def delete_node(project_id: str, node_id: str, db: Session = Depends(get_db)):
    logger.info(f"[DELETE] API call to delete node: {node_id} from project: {project_id}")

    if not get_project_by_id(db, project_id):
        logger.warning(f"[DELETE] Project not found: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")

    result = await remove_node(db, project_id, node_id)
    if result is None:
        logger.warning(f"[DELETE] Node not found: {node_id}")
        raise HTTPException(status_code=404, detail="Node not found")

    return result
