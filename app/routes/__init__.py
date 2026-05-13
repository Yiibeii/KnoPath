from fastapi import APIRouter
from routes.projects import router as projects_router
from routes.nodes import router as nodes_router
from routes.settings import router as settings_router
from routes.ws import router as ws_router
from routes.wiki import router as wiki_router

router = APIRouter(prefix="/api/v1")
router.include_router(projects_router)
router.include_router(nodes_router)
router.include_router(settings_router)
router.include_router(ws_router)
router.include_router(wiki_router)
