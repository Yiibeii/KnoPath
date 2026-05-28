import os
import traceback
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from config import get_database_url, get_repository_settings, set_repository_root, get_global_settings, update_global_settings
from database import reconfigure_database
from file_watcher import reconfigure_file_watcher
from schemas import RepositorySettingsResponse, RepositorySettingsUpdate, GlobalSettings, GlobalSettingsUpdate
from logger import get_logger

logger = get_logger('settings')
router = APIRouter(tags=["settings"])

PROMPT_DIR = Path(__file__).parent.parent / "prompt"


@router.get("/settings/default-prompt")
def get_default_prompt(lang: str = Query(default="en")):
    """获取默认系统提示词"""
    if lang == "zh":
        prompt_path = PROMPT_DIR / "system_prompt_zh.jinja2"
    else:
        prompt_path = PROMPT_DIR / "system_prompt.jinja2"
    if not prompt_path.exists():
        prompt_path = PROMPT_DIR / "system_prompt.jinja2"
    return {"prompt": prompt_path.read_text(encoding="utf-8")}


@router.get("/settings/global", response_model=GlobalSettings)
def get_global_settings_route():
    return get_global_settings()


@router.get("/settings/env-config")
def get_env_config():
    """Return LLM config from .env for frontend to use as defaults."""
    return {
        "apiKey": os.getenv("LLM_API_KEY", ""),
        "baseUrl": os.getenv("LLM_BASE_URL", ""),
        "model": os.getenv("LLM_MODEL_NAME", ""),
    }


@router.put("/settings/global", response_model=GlobalSettings)
def update_global_settings_route(payload: GlobalSettingsUpdate):
    update_data = payload.model_dump(exclude_unset=True)
    return update_global_settings(update_data)


@router.get("/settings/repository", response_model=RepositorySettingsResponse)
def get_repository_settings_route():
    return RepositorySettingsResponse(**get_repository_settings())


@router.get("/settings/repository/validate")
def validate_repository_settings_route():
    """检查当前配置的仓库路径是否存在"""
    try:
        repo_settings = get_repository_settings()
        repository_root = repo_settings["repositoryRoot"]
        
        exists = os.path.isdir(repository_root)
        has_raw = os.path.isdir(repo_settings["rawPath"])
        has_wiki = os.path.isdir(repo_settings["wikiPath"])
        has_knopath = os.path.isdir(repo_settings["knopathPath"])
        
        return {
            "valid": exists and has_raw and has_wiki and has_knopath,
            "exists": exists,
            "repositoryRoot": repository_root,
            "hasRaw": has_raw,
            "hasWiki": has_wiki,
            "hasKnoPath": has_knopath,
        }
    except Exception as e:
        logger.error(f"Error validating repository settings: {e}")
        return {
            "valid": False,
            "exists": False,
            "repositoryRoot": None,
            "hasRaw": False,
            "hasWiki": False,
            "hasKnoPath": False,
        }


@router.put("/settings/repository", response_model=RepositorySettingsResponse)
def update_repository_settings_route(payload: RepositorySettingsUpdate):
    try:
        repository_root = payload.repositoryRoot.strip()
        if not repository_root:
            raise HTTPException(status_code=400, detail="repositoryRoot is required")
        if not os.path.isabs(repository_root):
            raise HTTPException(status_code=400, detail="repositoryRoot must be an absolute path")

        logger.info(f"Setting repository root to: {repository_root}")
        paths = set_repository_root(repository_root, persist=True)
        logger.info(f"Paths set: {paths}")
        
        logger.info("Reconfiguring database...")
        reconfigure_database(get_database_url())
        logger.info("Database reconfigured")
        
        logger.info("Reconfiguring file watcher...")
        reconfigure_file_watcher(paths["repositoryRoot"])
        logger.info("File watcher reconfigured")
        
        return RepositorySettingsResponse(**paths)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating repository settings: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
