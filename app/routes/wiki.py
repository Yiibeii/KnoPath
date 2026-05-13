from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from database import get_db
from sqlalchemy.orm import Session
from models import WikiPage, Project
from schemas import WikiCompileRequest, WikiSyncRequest, WikiGraphData, WikiPageBase
from services.wiki_service import (
    get_wiki_graph, get_project_wiki_pages, compile_wiki,
    delete_wiki_page, sync_wiki_pages_from_insights,
    delete_wiki_page_file, delete_wiki_project_dir,
    stream_sync_wiki_pages, sync_wiki_pages_from_files,
)
from services.lint_service import lint_wiki, lint_all_projects
from services.log_service import read_log_entries, read_all_logs
from logger import get_logger

logger = get_logger('routes.wiki')
router = APIRouter(prefix="/wiki", tags=["wiki"])


@router.get("/graph", response_model=WikiGraphData)
async def get_graph(db: Session = Depends(get_db)):
    return get_wiki_graph(db)


@router.post("/import", response_model=WikiGraphData)
async def import_pages_from_files(db: Session = Depends(get_db)):
    return sync_wiki_pages_from_files(db)


@router.get("/projects/{project_id}/pages", response_model=list[WikiPageBase])
async def get_project_pages(project_id: str, db: Session = Depends(get_db)):
    return get_project_wiki_pages(db, project_id)


@router.post("/sync", response_model=WikiGraphData)
async def sync_pages(request: WikiSyncRequest, db: Session = Depends(get_db)):
    model_config = request.modelConfig
    if not model_config or not model_config.get("apiKey"):
        raise HTTPException(status_code=400, detail="Model configuration with apiKey is required")

    try:
        result = await sync_wiki_pages_from_insights(db, request.projectId, model_config)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Wiki sync failed: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.post("/sync/stream")
async def sync_pages_stream(request: WikiSyncRequest, db: Session = Depends(get_db)):
    model_config = request.modelConfig
    if not model_config or not model_config.get("apiKey"):
        raise HTTPException(status_code=400, detail="Model configuration with apiKey is required")

    return StreamingResponse(
        stream_sync_wiki_pages(db, request.projectId, model_config),
        media_type="text/event-stream",
    )


@router.post("/compile", response_model=WikiGraphData)
async def compile(request: WikiCompileRequest, db: Session = Depends(get_db)):
    model_config = request.modelConfig
    if not model_config or not model_config.get("apiKey"):
        raise HTTPException(status_code=400, detail="Model configuration with apiKey is required")

    try:
        result = await compile_wiki(db, request.projectId, model_config, request.nodeIds)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Wiki compilation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Compilation failed: {str(e)}")


@router.delete("/pages/{page_id}")
async def delete_page(page_id: str, db: Session = Depends(get_db)):
    if not delete_wiki_page(db, page_id):
        raise HTTPException(status_code=404, detail="Wiki page not found")
    return {"message": "Wiki page deleted"}


@router.delete("/pages/{page_id}/local")
async def delete_page_local(page_id: str, db: Session = Depends(get_db)):
    page = db.query(WikiPage).filter(WikiPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Wiki page not found")
    project = db.query(Project).filter(Project.id == page.source_project_id).first()
    project_title = project.title if project else "Unknown"
    deleted = delete_wiki_page_file(page, project_title)
    if deleted:
        return {"message": "Wiki page local file deleted"}
    return {"message": "No local file found for this wiki page"}


@router.delete("/projects/{project_id}/local")
async def delete_project_wiki_local(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    deleted = delete_wiki_project_dir(project.title)
    if deleted:
        return {"message": "Wiki project local files deleted"}
    return {"message": "No local wiki files found for this project"}


@router.get("/lint")
async def lint_all(db: Session = Depends(get_db)):
    results = lint_all_projects(db, auto_fix=False)
    return {
        projectId: result.to_dict()
        for projectId, result in results.items()
    }


@router.get("/lint/{project_id}")
async def lint_project(project_id: str, auto_fix: bool = False, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    result = lint_wiki(db, project_id, auto_fix=auto_fix)
    if auto_fix:
        db.commit()
    return result.to_dict()


@router.get("/logs")
async def get_all_logs(db: Session = Depends(get_db)):
    return read_all_logs(db)


@router.get("/logs/{project_id}")
async def get_project_logs(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return read_log_entries(db, project_id)
