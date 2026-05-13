import json
import os
import shutil
import logging
from typing import Any

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger('config')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
LOG_DIR = os.path.join(BASE_DIR, "logs")
RUNTIME_CONFIG_PATH = os.path.join(DATA_DIR, "runtime_config.json")
DEFAULT_REPOSITORY_ROOT = APP_ROOT
LEGACY_STORAGE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "vault"))
LEGACY_DB_PATH = os.path.join(DATA_DIR, "knopath.db")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

_runtime_state: dict[str, Any] = {}

DEFAULT_GLOBAL_SETTINGS = {
    "model": {
        "model": "gpt-4o",
        "baseUrl": "https://api.openai.com/v1",
        "temperature": 0.7,
        "systemPrompt": ""
    },
    "knowledgeBase": {
        "directoryName": "",
        "directoryPath": "",
        "autoInit": True,
        "lastValidated": None,
        "pickedDirectory": None,
        "templates": {
            "readme": "",
            "claude": "",
            "index": ""
        }
    }
}


def _read_runtime_config() -> dict[str, Any]:
    if not os.path.exists(RUNTIME_CONFIG_PATH):
        return {}

    try:
        with open(RUNTIME_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}

    return data if isinstance(data, dict) else {}


def _write_runtime_config(data: dict[str, Any]) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(RUNTIME_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_global_settings_path() -> str:
    return os.path.join(get_knopath_dir(), "settings.json")


def get_global_settings() -> dict[str, Any]:
    settings_path = get_global_settings_path()
    if not os.path.exists(settings_path):
        return DEFAULT_GLOBAL_SETTINGS.copy()
    
    try:
        with open(settings_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return DEFAULT_GLOBAL_SETTINGS.copy()
    
    result = DEFAULT_GLOBAL_SETTINGS.copy()
    result.update(data)
    return result


def update_global_settings(settings: dict[str, Any]) -> dict[str, Any]:
    current = get_global_settings()
    
    if "model" in settings:
        current["model"] = {**current.get("model", {}), **settings["model"]}
    if "knowledgeBase" in settings:
        current["knowledgeBase"] = {**current.get("knowledgeBase", {}), **settings["knowledgeBase"]}
        if "templates" in settings["knowledgeBase"]:
            current["knowledgeBase"]["templates"] = {
                **current["knowledgeBase"].get("templates", {}),
                **settings["knowledgeBase"]["templates"]
            }
    
    settings_path = get_global_settings_path()
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    
    return current


def _resolve_initial_repository_root() -> str:
    repository_root = os.getenv("REPOSITORY_ROOT")
    if repository_root:
        root = os.path.abspath(repository_root)
        if os.path.isdir(root):
            return root

    storage_path = os.getenv("STORAGE_PATH")
    if storage_path:
        storage_path = os.path.abspath(storage_path)
        if os.path.isdir(storage_path):
            if os.path.basename(storage_path).lower() == ".knopath":
                return os.path.dirname(storage_path)
            return storage_path

    runtime_config = _read_runtime_config()
    configured_root = runtime_config.get("repositoryRoot")
    if isinstance(configured_root, str) and configured_root.strip():
        root = os.path.abspath(configured_root)
        if os.path.isdir(root):
            return root
        logger.warning(f"Configured repository root does not exist: {root}, clearing config")
        _write_runtime_config({})

    return ""


def get_repository_root() -> str:
    return _runtime_state.get("repository_root", "")


def get_storage_path() -> str:
    return get_repository_root()


def get_knopath_dir() -> str:
    root = get_repository_root()
    return os.path.join(root, ".knopath") if root else ""


def get_database_path() -> str:
    knopath_dir = get_knopath_dir()
    return os.path.join(knopath_dir, "knopath.db") if knopath_dir else ""


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url
    db_path = get_database_path()
    if db_path:
        return f"sqlite:///{db_path}"
    return "sqlite:///:memory:"


def get_repository_settings() -> dict[str, str]:
    root = get_repository_root()
    if not root:
        return {
            "repositoryRoot": "",
            "rawPath": "",
            "wikiPath": "",
            "knopathPath": "",
            "databasePath": "",
        }
    return {
        "repositoryRoot": root,
        "rawPath": os.path.join(root, "raw"),
        "wikiPath": os.path.join(root, "wiki"),
        "knopathPath": get_knopath_dir(),
        "databasePath": get_database_path(),
    }


def ensure_repository_structure(repository_root: str | None = None) -> dict[str, str]:
    root = repository_root or get_repository_root()
    
    if not root:
        return {
            "repositoryRoot": "",
            "rawPath": "",
            "wikiPath": "",
            "knopathPath": "",
            "databasePath": "",
        }
    
    root = os.path.abspath(root)
    raw_path = os.path.join(root, "raw")
    wiki_path = os.path.join(root, "wiki")
    knopath_path = os.path.join(root, ".knopath")

    os.makedirs(root, exist_ok=True)
    os.makedirs(raw_path, exist_ok=True)
    os.makedirs(wiki_path, exist_ok=True)
    os.makedirs(knopath_path, exist_ok=True)

    return {
        "repositoryRoot": root,
        "rawPath": raw_path,
        "wikiPath": wiki_path,
        "knopathPath": knopath_path,
        "databasePath": os.path.join(knopath_path, "knopath.db"),
    }


def _move_if_missing(source: str, target: str) -> None:
    if not os.path.exists(source) or os.path.exists(target):
        return
    parent = os.path.dirname(target)
    if parent:
        os.makedirs(parent, exist_ok=True)
    shutil.move(source, target)


def _migrate_legacy_storage() -> None:
    if not get_repository_root():
        return

    target_paths = ensure_repository_structure()

    _move_if_missing(os.path.join(LEGACY_STORAGE_PATH, "raw"), target_paths["rawPath"])
    _move_if_missing(os.path.join(LEGACY_STORAGE_PATH, "wiki"), target_paths["wikiPath"])
    _move_if_missing(os.path.join(LEGACY_STORAGE_PATH, "knopath.db"), target_paths["databasePath"])
    _move_if_missing(os.path.join(LEGACY_STORAGE_PATH, "knopath.db-wal"), f'{target_paths["databasePath"]}-wal')
    _move_if_missing(os.path.join(LEGACY_STORAGE_PATH, "knopath.db-shm"), f'{target_paths["databasePath"]}-shm')
    _move_if_missing(LEGACY_DB_PATH, target_paths["databasePath"])

    if os.path.isdir(LEGACY_STORAGE_PATH) and not os.listdir(LEGACY_STORAGE_PATH):
        os.rmdir(LEGACY_STORAGE_PATH)


def set_repository_root(repository_root: str, persist: bool = True) -> dict[str, str]:
    if not repository_root or not repository_root.strip():
        _runtime_state["repository_root"] = ""
        if persist:
            _write_runtime_config({"repositoryRoot": ""})
        return get_repository_settings()

    normalized_root = os.path.abspath(repository_root)
    previous_root = _runtime_state.get("repository_root")
    previous_knopath_dir = os.path.join(previous_root, ".knopath") if previous_root else None

    _runtime_state["repository_root"] = normalized_root
    paths = ensure_repository_structure(normalized_root)

    if previous_root and previous_root != normalized_root:
        _move_if_missing(os.path.join(previous_root, "raw"), paths["rawPath"])
        _move_if_missing(os.path.join(previous_root, "wiki"), paths["wikiPath"])
        if previous_knopath_dir:
            _move_if_missing(os.path.join(previous_knopath_dir, "knopath.db"), paths["databasePath"])
            _move_if_missing(os.path.join(previous_knopath_dir, "knopath.db-wal"), f'{paths["databasePath"]}-wal')
            _move_if_missing(os.path.join(previous_knopath_dir, "knopath.db-shm"), f'{paths["databasePath"]}-shm')

    if persist:
        _write_runtime_config({"repositoryRoot": normalized_root})
    return paths


os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)
set_repository_root(_resolve_initial_repository_root(), persist=False)
_migrate_legacy_storage()
