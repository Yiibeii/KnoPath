class TestHealthCheck:
    def test_root(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert response.json()["message"] == "KnoPath API is running"

    def test_health_check(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"


class TestProjectCRUD:
    def test_create_project(self, client):
        response = client.post("/api/v1/projects", json={"title": "Test Project"})
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Project"
        assert data["nodeCount"] == 0
        assert data["isFavorite"] is False
        assert "id" in data
        assert "createdAt" in data

    def test_create_project_default_title(self, client):
        response = client.post("/api/v1/projects", json={})
        assert response.status_code == 200
        assert response.json()["title"] == "Untitled Project"

    def test_get_projects_empty(self, client):
        response = client.get("/api/v1/projects")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_projects_with_data(self, client):
        client.post("/api/v1/projects", json={"title": "Project 1"})
        client.post("/api/v1/projects", json={"title": "Project 2"})

        response = client.get("/api/v1/projects")
        assert response.status_code == 200
        assert len(response.json()) == 2

    def test_get_single_project(self, client):
        create_response = client.post("/api/v1/projects", json={"title": "Test Project"})
        project_id = create_response.json()["id"]

        response = client.get(f"/api/v1/projects/{project_id}")
        assert response.status_code == 200
        assert response.json()["title"] == "Test Project"

    def test_get_nonexistent_project(self, client):
        response = client.get("/api/v1/projects/nonexistent-id")
        assert response.status_code == 404

    def test_update_project_title(self, client):
        create_response = client.post("/api/v1/projects", json={"title": "Original"})
        project_id = create_response.json()["id"]

        response = client.put(
            f"/api/v1/projects/{project_id}",
            json={"title": "Updated Title"}
        )
        assert response.status_code == 200
        assert response.json()["title"] == "Updated Title"

    def test_update_project_favorite(self, client):
        create_response = client.post("/api/v1/projects", json={"title": "Test"})
        project_id = create_response.json()["id"]

        response = client.put(
            f"/api/v1/projects/{project_id}",
            json={"isFavorite": True}
        )
        assert response.status_code == 200
        assert response.json()["isFavorite"] is True

    def test_update_project_partial(self, client):
        create_response = client.post("/api/v1/projects", json={"title": "Original"})
        project_id = create_response.json()["id"]

        response = client.put(
            f"/api/v1/projects/{project_id}",
            json={"title": "New Title"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "New Title"
        assert data["isFavorite"] is False

    def test_update_nonexistent_project(self, client):
        response = client.put(
            "/api/v1/projects/nonexistent-id",
            json={"title": "Updated"}
        )
        assert response.status_code == 404

    def test_delete_project(self, client):
        create_response = client.post("/api/v1/projects", json={"title": "To Delete"})
        project_id = create_response.json()["id"]

        response = client.delete(f"/api/v1/projects/{project_id}")
        assert response.status_code == 200

        get_response = client.get(f"/api/v1/projects/{project_id}")
        assert get_response.status_code == 404

    def test_delete_nonexistent_project(self, client):
        response = client.delete("/api/v1/projects/nonexistent-id")
        assert response.status_code == 404

    def test_delete_project_cascades_nodes(self, client):
        import sys, os
        sys.path.insert(0, os.path.dirname(__file__))
        from conftest import make_project_data, make_node_data

        save_data = make_project_data(
            project_id="cascade-test",
            nodes=[make_node_data("n1"), make_node_data("n2", parent_id="n1", node_type="branch")],
            edges=[{"id": "e1", "source": "n1", "target": "n2"}],
        )
        client.post("/api/v1/projects/save", json=save_data)

        response = client.delete("/api/v1/projects/cascade-test")
        assert response.status_code == 200

        get_response = client.get("/api/v1/projects/cascade-test")
        assert get_response.status_code == 404

    def test_projects_ordered_by_updated_at(self, client):
        client.post("/api/v1/projects", json={"title": "First"})
        client.post("/api/v1/projects", json={"title": "Second"})

        response = client.get("/api/v1/projects")
        data = response.json()
        assert data[0]["title"] == "Second"
        assert data[1]["title"] == "First"


class TestProjectImportSync:
    def test_import_missing_raw_directory_silently_clears_projects(self, client, tmp_path, monkeypatch):
        client.post("/api/v1/projects", json={"title": "Stale Project"})
        monkeypatch.setattr("routes.projects.get_storage_path", lambda: str(tmp_path))

        response = client.post("/api/v1/projects/import")

        assert response.status_code == 200
        assert response.json() == []
        assert client.get("/api/v1/projects").json() == []

    def test_import_empty_raw_directory_silently_clears_projects(self, client, tmp_path, monkeypatch):
        client.post("/api/v1/projects", json={"title": "Stale Project"})
        raw_dir = tmp_path / "raw"
        raw_dir.mkdir()
        (raw_dir / "Empty Project").mkdir()
        monkeypatch.setattr("routes.projects.get_storage_path", lambda: str(tmp_path))

        response = client.post("/api/v1/projects/import")

        assert response.status_code == 200
        assert response.json() == []
        assert client.get("/api/v1/projects").json() == []

    def test_import_removes_nodes_missing_from_local_files(self, client, tmp_path, monkeypatch):
        raw_project = tmp_path / "raw" / "Local Project"
        raw_project.mkdir(parents=True)
        (raw_project / "root.md").write_text(
            "\n".join([
                "---",
                "id: local-root",
                "parent_id: None",
                "---",
                "",
                "# Local Root",
                "",
                "## Question",
                "Local Root",
            ]),
            encoding="utf-8",
        )
        monkeypatch.setattr("routes.projects.get_storage_path", lambda: str(tmp_path))

        first_response = client.post("/api/v1/projects/import")
        assert first_response.status_code == 200
        project = first_response.json()[0]
        assert project["nodeCount"] == 1

        (raw_project / "root.md").unlink()
        second_response = client.post("/api/v1/projects/import")

        assert second_response.status_code == 200
        assert second_response.json() == []
        assert client.get("/api/v1/projects").json() == []
