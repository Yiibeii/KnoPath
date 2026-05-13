import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
from unittest.mock import patch, AsyncMock

from conftest import make_project_data, make_node_data


class TestWikiGraphAPI:
    def test_get_empty_graph(self, client):
        response = client.get("/api/v1/wiki/graph")
        assert response.status_code == 200
        data = response.json()
        assert data["pages"] == []
        assert data["links"] == []

    def test_get_project_pages_empty(self, client):
        create_resp = client.post("/api/v1/projects", json={"title": "Test"})
        project_id = create_resp.json()["id"]

        response = client.get(f"/api/v1/wiki/projects/{project_id}/pages")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_project_pages_nonexistent_project(self, client):
        response = client.get("/api/v1/wiki/projects/nonexistent-id/pages")
        assert response.status_code == 200
        assert response.json() == []

    def test_delete_nonexistent_page(self, client):
        response = client.delete("/api/v1/wiki/pages/nonexistent-id")
        assert response.status_code == 404

    def test_compile_without_api_key(self, client):
        create_resp = client.post("/api/v1/projects", json={"title": "Test"})
        project_id = create_resp.json()["id"]

        response = client.post("/api/v1/wiki/compile", json={
            "projectId": project_id,
            "nodeIds": ["node-1"],
            "modelConfig": None,
        })
        assert response.status_code == 400

    def test_compile_with_empty_api_key(self, client):
        create_resp = client.post("/api/v1/projects", json={"title": "Test"})
        project_id = create_resp.json()["id"]

        response = client.post("/api/v1/wiki/compile", json={
            "projectId": project_id,
            "nodeIds": ["node-1"],
            "modelConfig": {"apiKey": "", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
        })
        assert response.status_code == 400

    def test_compile_nonexistent_project(self, client):
        response = client.post("/api/v1/wiki/compile", json={
            "projectId": "nonexistent-id",
            "nodeIds": ["node-1"],
            "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
        })
        assert response.status_code == 400


class TestWikiFileImport:
    def test_import_wiki_files_without_raw_keeps_page_without_source(self, client, tmp_path, monkeypatch):
        wiki_project = tmp_path / "wiki" / "Detached"
        wiki_project.mkdir(parents=True)
        (wiki_project / "Page.md").write_text(
            "\n".join([
                "---",
                "id: wiki-page-1",
                "title: Detached Page",
                "status: draft",
                "sensitivity: internal",
                "source_node_id: missing-node",
                "source_project_id: missing-project",
                'tags: ["detached"]',
                "---",
                "",
                "## 摘要",
                "",
                "A page whose raw node is gone.",
                "",
                "## 核心内容",
                "",
                "The wiki page should still survive.",
            ]),
            encoding="utf-8",
        )
        monkeypatch.setattr("services.wiki_service.get_storage_path", lambda: str(tmp_path))

        response = client.post("/api/v1/wiki/import")

        assert response.status_code == 200
        graph = response.json()
        assert len(graph["pages"]) == 1
        page = graph["pages"][0]
        assert page["title"] == "Detached Page"
        assert page["sourceProjectId"] is None
        assert page["sourceNodeId"] is None
        assert "detached" in page["tags"]

    def test_import_empty_wiki_directory_clears_wiki_without_touching_projects(self, client, tmp_path, monkeypatch):
        client.post("/api/v1/projects", json={"title": "Project Survives"})
        wiki_project = tmp_path / "wiki" / "Detached"
        wiki_project.mkdir(parents=True)
        (wiki_project / "Page.md").write_text(
            "\n".join([
                "---",
                "id: wiki-page-1",
                "title: Detached Page",
                "---",
                "",
                "## 核心内容",
                "Content",
            ]),
            encoding="utf-8",
        )
        monkeypatch.setattr("services.wiki_service.get_storage_path", lambda: str(tmp_path))

        first_response = client.post("/api/v1/wiki/import")
        assert len(first_response.json()["pages"]) == 1

        (wiki_project / "Page.md").unlink()
        second_response = client.post("/api/v1/wiki/import")

        assert second_response.status_code == 200
        assert second_response.json()["pages"] == []
        projects = client.get("/api/v1/projects").json()
        assert len(projects) == 1
        assert projects[0]["title"] == "Project Survives"

    def test_raw_import_missing_raw_does_not_clear_existing_wiki(self, client, tmp_path, monkeypatch):
        wiki_project = tmp_path / "wiki" / "Detached"
        wiki_project.mkdir(parents=True)
        (wiki_project / "Page.md").write_text(
            "\n".join([
                "---",
                "id: wiki-page-1",
                "title: Detached Page",
                "---",
                "",
                "## 核心内容",
                "Content",
            ]),
            encoding="utf-8",
        )
        monkeypatch.setattr("services.wiki_service.get_storage_path", lambda: str(tmp_path))
        monkeypatch.setattr("routes.projects.get_storage_path", lambda: str(tmp_path))

        wiki_response = client.post("/api/v1/wiki/import")
        assert len(wiki_response.json()["pages"]) == 1

        raw_response = client.post("/api/v1/projects/import")
        graph_response = client.get("/api/v1/wiki/graph")

        assert raw_response.status_code == 200
        assert raw_response.json() == []
        assert len(graph_response.json()["pages"]) == 1


class TestWikiCompileWithMock:

    @staticmethod
    def _content_pages(pages: list[dict]) -> list[dict]:
        """Filter out admin pages (index, log) from a page list."""
        admin_titles = {"wiki-index", "wiki-log"}
        return [p for p in pages if p.get("canonicalTitle") not in admin_titles]

    def test_sync_marked_node_can_generate_multiple_wiki_pages(self, client):
        node = make_node_data(
            "node-multi",
            question="How do OpenAI agents use tool calling for retrieval?",
            answer="The source discusses OpenAI Agents, tool calling, and retrieval workflows.",
            summary="Agents and retrieval overview",
        )
        node["data"]["isMarked"] = True
        save_data = make_project_data(
            project_id="wiki-multi-page-test",
            title="Multi Page Test",
            nodes=[node],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_llm_response = json.dumps({
            "pages": [
                {
                    "title": "OpenAI Agents",
                    "canonicalTitle": "openai-agents",
                    "pageKind": "entity",
                    "content": "OpenAI Agents coordinate model calls and tools.",
                    "summary": "OpenAI Agents coordinate model calls and tools.",
                    "tags": ["agent"],
                    "sourceNodeId": "node-multi",
                    "relatedTopics": ["Tool Calling"],
                },
                {
                    "title": "Tool Calling",
                    "canonicalTitle": "tool-calling",
                    "pageKind": "concept",
                    "content": "Tool calling lets a model request external actions such as retrieval.",
                    "summary": "Tool calling lets a model request external actions.",
                    "tags": ["tooling"],
                    "sourceNodeId": "node-multi",
                    "relatedTopics": ["OpenAI Agents"],
                },
            ],
            "links": [
                {
                    "sourceTitle": "OpenAI Agents",
                    "targetTitle": "Tool Calling",
                    "linkType": "extension",
                    "context": "Agents use tool calling to perform retrieval and actions.",
                }
            ],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_llm_response):
            response = client.post("/api/v1/wiki/sync", json={
                "projectId": "wiki-multi-page-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert response.status_code == 200
        data = response.json()
        titles = {page["title"] for page in data["pages"]}
        assert {"OpenAI Agents", "Tool Calling"} <= titles
        generated_pages = [page for page in data["pages"] if page["sourceNodeId"] == "node-multi"]
        assert len(generated_pages) == 2
        assert any("entity" in page["tags"] for page in generated_pages)
        assert any("concept" in page["tags"] for page in generated_pages)
        # canonicalTitle should be passed through
        assert any(page.get("canonicalTitle") == "openai-agents" for page in generated_pages)
        assert any(page.get("canonicalTitle") == "tool-calling" for page in generated_pages)
        assert len(data["links"]) == 1
        assert data["links"][0]["linkType"] == "extension"

    def test_templates_drive_prompt_and_repository_files(self, client, tmp_path, monkeypatch):
        templates = {
            "readme": "# Project Rules\n\nUse project {{projectTitle}} rules.",
            "claude": "# Assistant Rules\n\nPreserve source references.",
            "index": "# Custom Index\n\nUpdated: {{updatedAt}}\n\n{{wikiLinks}}\n\nCount: {{count}} Insight{{plural}}.",
        }
        monkeypatch.setattr("services.wiki_service.get_storage_path", lambda: str(tmp_path))
        monkeypatch.setattr(
            "services.wiki_service.get_global_settings",
            lambda: {"knowledgeBase": {"templates": templates}},
        )

        node = make_node_data(
            "node-template",
            question="How should templates affect wiki output?",
            answer="Templates should control rules and repository files.",
            summary="Template usage",
        )
        node["data"]["isMarked"] = True
        client.post("/api/v1/projects/save", json=make_project_data(
            project_id="wiki-template-test",
            title="Template Test",
            nodes=[node],
        ))

        mock_resp = json.dumps({
            "pages": [{
                "title": "Template Driven Wiki",
                "content": "Generated content",
                "summary": "Template driven summary",
                "tags": ["concept"],
                "sourceNodeId": "node-template",
            }],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_resp) as call_llm:
            response = client.post("/api/v1/wiki/sync", json={
                "projectId": "wiki-template-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert response.status_code == 200
        user_prompt = call_llm.await_args.args[1]
        assert "knowledgeBaseRules" in user_prompt
        assert "Use project {{projectTitle}} rules." in user_prompt
        assert "aiAssistantRules" in user_prompt
        assert "Preserve source references." in user_prompt

        assert (tmp_path / "README.md").read_text(encoding="utf-8").startswith("# Project Rules")
        assert "Preserve source references." in (tmp_path / "CLAUDE.md").read_text(encoding="utf-8")
        index_content = (tmp_path / "index.md").read_text(encoding="utf-8")
        assert "# Custom Index" in index_content
        assert "Template Driven Wiki" in index_content
        assert "Count: 1 Insight." in index_content

    def test_stream_sync_skips_up_to_date_marked_node(self, client):
        node = make_node_data(
            "node-stream-skip",
            question="What should be generated once?",
            answer="Generate this once only.",
            summary="Stream skip test",
        )
        node["data"]["isMarked"] = True
        save_data = make_project_data(
            project_id="wiki-stream-skip-test",
            title="Stream Skip Test",
            nodes=[node],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_llm_response = json.dumps({
            "pages": [
                {
                    "title": "Generated Once",
                    "content": "This page should not be regenerated.",
                    "summary": "Generated once.",
                    "tags": ["test"],
                    "sourceNodeId": "node-stream-skip",
                }
            ],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_llm_response) as call_llm:
            first_response = client.post("/api/v1/wiki/sync/stream", json={
                "projectId": "wiki-stream-skip-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })
            assert first_response.status_code == 200
            assert "Generated Once" in first_response.text
            assert call_llm.await_count == 1

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, side_effect=AssertionError("LLM should not be called for up-to-date nodes")) as call_llm:
            second_response = client.post("/api/v1/wiki/sync/stream", json={
                "projectId": "wiki-stream-skip-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })
            assert second_response.status_code == 200
            assert '"status": "skipped"' in second_response.text
            assert '"skipped": 1' in second_response.text
            assert call_llm.await_count == 0

    def test_compile_creates_pages_and_links(self, client):
        save_data = make_project_data(
            project_id="wiki-test-project",
            title="Wiki Test",
            nodes=[
                make_node_data("node-1", question="What is Python?", answer="Python is a programming language.", summary="Python overview"),
                make_node_data("node-2", question="What is FastAPI?", answer="FastAPI is a web framework.", summary="FastAPI overview"),
            ],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_llm_response = json.dumps({
            "pages": [
                {
                    "title": "Python Programming Language",
                    "content": "Python is a versatile programming language.\n\nSee also: [[FastAPI Web Framework]]",
                    "tags": ["python", "programming"],
                    "sourceNodeId": "node-1",
                },
                {
                    "title": "FastAPI Web Framework",
                    "content": "FastAPI is a modern web framework built on Python.\n\nPrerequisite: [[Python Programming Language]]",
                    "tags": ["fastapi", "web-framework", "python"],
                    "sourceNodeId": "node-2",
                },
            ],
            "links": [
                {
                    "sourceTitle": "FastAPI Web Framework",
                    "targetTitle": "Python Programming Language",
                    "linkType": "prerequisite",
                    "context": "FastAPI requires Python knowledge",
                },
                {
                    "sourceTitle": "Python Programming Language",
                    "targetTitle": "FastAPI Web Framework",
                    "linkType": "reference",
                    "context": "Python mentions FastAPI as an example",
                },
            ],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_llm_response):
            response = client.post("/api/v1/wiki/compile", json={
                "projectId": "wiki-test-project",
                "nodeIds": ["node-1", "node-2"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert response.status_code == 200
        data = response.json()
        pages = self._content_pages(data["pages"])
        assert len(pages) == 2
        assert len(data["links"]) == 2

        page_titles = {p["title"] for p in pages}
        assert "Python Programming Language" in page_titles
        assert "FastAPI Web Framework" in page_titles

        for page in pages:
            assert page["sourceNodeId"] in ["node-1", "node-2"]
            assert page["sourceProjectId"] == "wiki-test-project"
            assert len(page["tags"]) > 0

        link_types = {l["linkType"] for l in data["links"]}
        assert "prerequisite" in link_types
        assert "reference" in link_types

    def test_compile_updates_existing_page(self, client):
        save_data = make_project_data(
            project_id="wiki-update-test",
            title="Update Test",
            nodes=[make_node_data("node-1", question="What is Docker?", answer="Docker is a container platform.", summary="Docker overview")],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_first = json.dumps({
            "pages": [{"title": "Docker Basics", "canonicalTitle": "docker-platform", "content": "Docker is a container platform.", "tags": ["docker"], "sourceNodeId": "node-1"}],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_first):
            first_resp = client.post("/api/v1/wiki/compile", json={
                "projectId": "wiki-update-test",
                "nodeIds": ["node-1"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert first_resp.status_code == 200
        first_pages = self._content_pages(first_resp.json()["pages"])
        assert len(first_pages) == 1
        first_page = first_pages[0]
        first_page_id = first_page["id"]
        assert first_page["canonicalTitle"] == "docker-platform"

        mock_second = json.dumps({
            "pages": [{"title": "Docker Container Platform", "canonicalTitle": "docker-platform", "content": "Updated content about Docker.", "tags": ["docker", "containers"], "sourceNodeId": "node-1"}],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_second):
            second_resp = client.post("/api/v1/wiki/compile", json={
                "projectId": "wiki-update-test",
                "nodeIds": ["node-1"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert second_resp.status_code == 200
        pages = self._content_pages(second_resp.json()["pages"])
        assert len(pages) == 1
        assert pages[0]["id"] == first_page_id
        assert pages[0]["title"] == "Docker Container Platform"
        assert "containers" in pages[0]["tags"]

    def test_delete_wiki_page(self, client):
        save_data = make_project_data(
            project_id="wiki-delete-test",
            title="Delete Test",
            nodes=[make_node_data("node-1", question="Q1", answer="A1")],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_resp = json.dumps({
            "pages": [{"title": "Test Page", "content": "Content", "tags": ["test"], "sourceNodeId": "node-1"}],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_resp):
            compile_resp = client.post("/api/v1/wiki/compile", json={
                "projectId": "wiki-delete-test",
                "nodeIds": ["node-1"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        page_id = compile_resp.json()["pages"][0]["id"]

        delete_resp = client.delete(f"/api/v1/wiki/pages/{page_id}")
        assert delete_resp.status_code == 200

        graph_resp = client.get("/api/v1/wiki/graph")
        assert graph_resp.status_code == 200
        assert all(p["id"] != page_id for p in graph_resp.json()["pages"])

    def test_get_graph_returns_all_pages(self, client):
        save_data = make_project_data(
            project_id="wiki-graph-test",
            title="Graph Test",
            nodes=[
                make_node_data("node-a", question="QA", answer="AA"),
                make_node_data("node-b", question="QB", answer="AB"),
            ],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_resp = json.dumps({
            "pages": [
                {"title": "Topic A", "content": "Content A", "tags": ["a"], "sourceNodeId": "node-a"},
                {"title": "Topic B", "content": "Content B", "tags": ["b"], "sourceNodeId": "node-b"},
            ],
            "links": [
                {"sourceTitle": "Topic A", "targetTitle": "Topic B", "linkType": "reference", "context": "A references B"},
            ],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_resp):
            client.post("/api/v1/wiki/compile", json={
                "projectId": "wiki-graph-test",
                "nodeIds": ["node-a", "node-b"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        graph_resp = client.get("/api/v1/wiki/graph")
        assert graph_resp.status_code == 200
        graph = graph_resp.json()
        content_pages = self._content_pages(graph["pages"])
        assert len(content_pages) == 2
        assert len(graph["links"]) == 1
        assert graph["links"][0]["linkType"] == "reference"

    def test_sync_with_canonical_title_dedup(self, client):
        """Two nodes producing pages with the same canonicalTitle should merge into one page."""
        node1 = make_node_data("node-dedup-1", question="What is Docker?", answer="Docker is a container platform.", summary="Docker overview")
        node1["data"]["isMarked"] = True
        node2 = make_node_data("node-dedup-2", question="Docker compose details?", answer="Docker Compose manages multi-container apps.", summary="Compose overview")
        node2["data"]["isMarked"] = True
        save_data = make_project_data(
            project_id="wiki-dedup-test",
            title="Dedup Test",
            nodes=[node1, node2],
        )
        client.post("/api/v1/projects/save", json=save_data)

        # First node creates a page with canonicalTitle "docker-platform"
        mock_first = json.dumps({
            "pages": [{
                "title": "Docker Basics",
                "canonicalTitle": "docker-platform",
                "content": "Docker is a container platform.",
                "tags": ["docker"],
                "sourceNodeId": "node-dedup-1",
            }],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_first):
            first_resp = client.post("/api/v1/wiki/sync", json={
                "projectId": "wiki-dedup-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert first_resp.status_code == 200
        first_pages = self._content_pages(first_resp.json()["pages"])
        assert len(first_pages) == 1
        first_page_id = first_pages[0]["id"]
        assert first_pages[0]["canonicalTitle"] == "docker-platform"

        # Second node generates same canonicalTitle — should update existing page
        mock_second = json.dumps({
            "pages": [{
                "title": "Docker Compose & Platform",
                "canonicalTitle": "docker-platform",
                "content": "Docker platform including Compose for multi-container apps.",
                "tags": ["docker", "compose"],
                "sourceNodeId": "node-dedup-2",
            }],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_second):
            second_resp = client.post("/api/v1/wiki/sync", json={
                "projectId": "wiki-dedup-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        assert second_resp.status_code == 200
        second_pages = self._content_pages(second_resp.json()["pages"])
        assert len(second_pages) == 1  # Merged, not duplicated
        assert second_pages[0]["id"] == first_page_id
        assert second_pages[0]["canonicalTitle"] == "docker-platform"
        assert "Compose" in second_pages[0]["title"] or "docker-platform" in second_pages[0]["tags"]
        # Both source nodes should be tracked
        assert "node-dedup-1" in second_pages[0]["sourceNodeIds"]
        assert "node-dedup-2" in second_pages[0]["sourceNodeIds"]

    def test_index_page_generated_after_compile(self, client):
        """After compile, a Wiki Index page should exist."""
        save_data = make_project_data(
            project_id="wiki-index-test",
            title="Index Test",
            nodes=[make_node_data("ix-node", question="Q", answer="A")],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_resp = json.dumps({
            "pages": [{"title": "Indexed Page", "content": "Content", "tags": ["test"], "sourceNodeId": "ix-node"}],
            "links": [],
        })
        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_resp):
            client.post("/api/v1/wiki/compile", json={
                "projectId": "wiki-index-test",
                "nodeIds": ["ix-node"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        graph = client.get("/api/v1/wiki/graph").json()
        index_pages = [p for p in graph["pages"] if p.get("canonicalTitle") == "wiki-index"]
        assert len(index_pages) == 1
        assert index_pages[0]["title"] == "Wiki Index"
        assert "Indexed Page" in index_pages[0]["content"]

    def test_log_page_generated_after_sync(self, client):
        """After sync, a Change Log page should exist with entries."""
        node = make_node_data("log-node", question="Q", answer="A", summary="Log test")
        node["data"]["isMarked"] = True
        save_data = make_project_data(
            project_id="wiki-log-test",
            title="Log Test",
            nodes=[node],
        )
        client.post("/api/v1/projects/save", json=save_data)

        mock_resp = json.dumps({
            "pages": [{"title": "Logged Page", "content": "Content", "tags": ["test"], "sourceNodeId": "log-node"}],
            "links": [],
        })
        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_resp):
            client.post("/api/v1/wiki/sync", json={
                "projectId": "wiki-log-test",
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        graph = client.get("/api/v1/wiki/graph").json()
        log_pages = [p for p in graph["pages"] if p.get("canonicalTitle") == "wiki-log"]
        assert len(log_pages) >= 1
        assert log_pages[0]["title"] == "Change Log"
        assert "Sync" in log_pages[0]["content"] or "Log" in log_pages[0]["content"]

    def test_get_project_pages_filters_by_project(self, client):
        save_data_1 = make_project_data(
            project_id="project-alpha",
            title="Alpha",
            nodes=[make_node_data("alpha-node", question="Alpha Q", answer="Alpha A")],
        )
        save_data_2 = make_project_data(
            project_id="project-beta",
            title="Beta",
            nodes=[make_node_data("beta-node", question="Beta Q", answer="Beta A")],
        )
        client.post("/api/v1/projects/save", json=save_data_1)
        client.post("/api/v1/projects/save", json=save_data_2)

        mock_alpha = json.dumps({
            "pages": [{"title": "Alpha Wiki", "content": "Alpha content", "tags": ["alpha"], "sourceNodeId": "alpha-node"}],
            "links": [],
        })
        mock_beta = json.dumps({
            "pages": [{"title": "Beta Wiki", "content": "Beta content", "tags": ["beta"], "sourceNodeId": "beta-node"}],
            "links": [],
        })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_alpha):
            client.post("/api/v1/wiki/compile", json={
                "projectId": "project-alpha",
                "nodeIds": ["alpha-node"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        with patch("services.wiki_service.call_llm", new_callable=AsyncMock, return_value=mock_beta):
            client.post("/api/v1/wiki/compile", json={
                "projectId": "project-beta",
                "nodeIds": ["beta-node"],
                "modelConfig": {"apiKey": "test-key", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "temperature": 0.3},
            })

        alpha_resp = client.get("/api/v1/wiki/projects/project-alpha/pages")
        assert alpha_resp.status_code == 200
        alpha_pages = alpha_resp.json()
        assert len(alpha_pages) == 1
        assert alpha_pages[0]["title"] == "Alpha Wiki"

        beta_resp = client.get("/api/v1/wiki/projects/project-beta/pages")
        assert beta_resp.status_code == 200
        beta_pages = beta_resp.json()
        assert len(beta_pages) == 1
        assert beta_pages[0]["title"] == "Beta Wiki"
