import sys
import os

if sys.platform == 'win32':
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    os.environ.setdefault('PYTHONUTF8', '1')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import initialize_database, dispose_database
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
