import pytest
import sys
import os
import tempfile
from unittest.mock import patch, AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Project, Node, Edge, WikiPage, WikiLink
from main import app


@pytest.fixture(autouse=True)
def setup_db():
    db_fd, db_path = tempfile.mkstemp(suffix='.db')
    database_url = f"sqlite:///{db_path}"
    engine = create_engine(database_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    engine.dispose()
    os.close(db_fd)
    os.unlink(db_path)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_file_storage():
    with patch("services.project_service.save_project_files", new_callable=AsyncMock, return_value=[]), \
         patch("services.project_service.delete_node_file", new_callable=AsyncMock, return_value=None):
        yield


def make_project_data(
    project_id="test-project-id",
    title="Test Project",
    nodes=None,
    edges=None,
    is_favorite=False,
):
    if nodes is None:
        nodes = []
    if edges is None:
        edges = []
    return {
        "project": {
            "id": project_id,
            "title": title,
            "nodes": nodes,
            "edges": edges,
            "nodeCount": len(nodes),
            "isFavorite": is_favorite,
        }
    }


def make_node_data(
    node_id="node-1",
    parent_id=None,
    question="Test Question",
    answer="Test Answer",
    node_type="root",
    summary="",
    context="",
):
    return {
        "id": node_id,
        "type": "knopath",
        "position": {"x": 100, "y": 100},
        "width": 290,
        "height": 380,
        "data": {
            "parentId": parent_id,
            "type": node_type,
            "question": question,
            "answer": answer,
            "summary": summary,
            "context": context,
            "isMarked": False,
            "isBranchCollapsed": False,
            "isNodeCollapsed": False,
            "childrenCount": 0,
        }
    }
