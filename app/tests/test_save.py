import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from conftest import make_project_data, make_node_data


class TestSaveProject:
    def test_save_new_project(self, client):
        save_data = make_project_data(
            nodes=[make_node_data()],
        )
        response = client.post("/api/v1/projects/save", json=save_data)
        assert response.status_code == 200
        data = response.json()
        assert data["nodeCount"] == 1
        assert data["message"] == "Project saved successfully"

    def test_save_project_with_multiple_nodes(self, client):
        save_data = make_project_data(
            project_id="multi-node",
            title="Multi Node",
            nodes=[
                make_node_data("node-1", question="Root"),
                make_node_data("node-2", parent_id="node-1", question="Branch", node_type="branch"),
            ],
            edges=[{"id": "edge-1", "source": "node-1", "target": "node-2"}],
        )
        response = client.post("/api/v1/projects/save", json=save_data)
        assert response.status_code == 200
        data = response.json()
        assert data["nodeCount"] == 2

        get_response = client.get("/api/v1/projects/multi-node")
        assert get_response.status_code == 200
        project = get_response.json()
        assert len(project["nodes"]) == 2
        assert len(project["edges"]) == 1

    def test_save_project_updates_existing(self, client):
        save_data_v1 = make_project_data(
            project_id="update-test",
            title="Version 1",
            nodes=[make_node_data("node-1", question="Q1")],
        )
        client.post("/api/v1/projects/save", json=save_data_v1)

        save_data_v2 = make_project_data(
            project_id="update-test",
            title="Version 2",
            nodes=[
                make_node_data("node-1", question="Q1 Updated"),
                make_node_data("node-2", parent_id="node-1", question="Q2", node_type="branch"),
            ],
            edges=[{"id": "e1", "source": "node-1", "target": "node-2"}],
        )
        response = client.post("/api/v1/projects/save", json=save_data_v2)
        assert response.status_code == 200

        get_response = client.get("/api/v1/projects/update-test")
        project = get_response.json()
        assert project["title"] == "Version 2"
        assert len(project["nodes"]) == 2

    def test_save_project_replaces_nodes(self, client):
        save_data_v1 = make_project_data(
            project_id="replace-test",
            nodes=[
                make_node_data("node-old", question="Old Node"),
            ],
        )
        client.post("/api/v1/projects/save", json=save_data_v1)

        save_data_v2 = make_project_data(
            project_id="replace-test",
            nodes=[
                make_node_data("node-new", question="New Node"),
            ],
        )
        client.post("/api/v1/projects/save", json=save_data_v2)

        get_response = client.get("/api/v1/projects/replace-test")
        project = get_response.json()
        assert len(project["nodes"]) == 1
        assert project["nodes"][0]["id"] == "node-new"

    def test_save_empty_project(self, client):
        save_data = make_project_data(project_id="empty-proj", title="Empty")
        response = client.post("/api/v1/projects/save", json=save_data)
        assert response.status_code == 200
        assert response.json()["nodeCount"] == 0

    def test_save_project_with_tree_structure(self, client):
        save_data = make_project_data(
            project_id="tree-project",
            title="Tree Structure",
            nodes=[
                make_node_data("root", question="Root"),
                make_node_data("child-1", parent_id="root", question="Child 1", node_type="branch"),
                make_node_data("child-2", parent_id="root", question="Child 2", node_type="branch"),
            ],
            edges=[
                {"id": "e1", "source": "root", "target": "child-1"},
                {"id": "e2", "source": "root", "target": "child-2"},
            ],
        )
        response = client.post("/api/v1/projects/save", json=save_data)
        assert response.status_code == 200

        get_response = client.get("/api/v1/projects/tree-project")
        project = get_response.json()

        root = next(n for n in project["nodes"] if n["id"] == "root")
        assert root["data"]["parentId"] is None

        child1 = next(n for n in project["nodes"] if n["id"] == "child-1")
        assert child1["data"]["parentId"] == "root"

        child2 = next(n for n in project["nodes"] if n["id"] == "child-2")
        assert child2["data"]["parentId"] == "root"

    def test_save_project_preserves_node_data(self, client):
        node = make_node_data(
            "data-node",
            question="What is RAG?",
            answer="Retrieval-Augmented Generation",
            summary="RAG combines retrieval and generation",
        )
        save_data = make_project_data(
            project_id="data-test",
            nodes=[node],
        )
        client.post("/api/v1/projects/save", json=save_data)

        get_response = client.get("/api/v1/projects/data-test")
        project = get_response.json()
        saved_node = project["nodes"][0]
        assert saved_node["data"]["question"] == "What is RAG?"
        assert saved_node["data"]["answer"] == "Retrieval-Augmented Generation"
        assert saved_node["data"]["summary"] == "RAG combines retrieval and generation"


class TestNodeDeletion:
    def test_delete_node(self, client):
        save_data = make_project_data(
            project_id="del-node-proj",
            nodes=[make_node_data("node-to-delete", question="Delete Me")],
        )
        client.post("/api/v1/projects/save", json=save_data)

        response = client.delete("/api/v1/projects/del-node-proj/nodes/node-to-delete")
        assert response.status_code == 200
        assert response.json()["message"] == "Node deleted"

        get_response = client.get("/api/v1/projects/del-node-proj")
        project = get_response.json()
        assert len(project["nodes"]) == 0

    def test_delete_node_nonexistent_project(self, client):
        response = client.delete("/api/v1/projects/nonexistent/nodes/node-1")
        assert response.status_code == 404

    def test_delete_node_nonexistent_node(self, client):
        save_data = make_project_data(project_id="existing-proj")
        client.post("/api/v1/projects/save", json=save_data)

        response = client.delete("/api/v1/projects/existing-proj/nodes/nonexistent-node")
        assert response.status_code == 404

    def test_delete_node_updates_count(self, client):
        save_data = make_project_data(
            project_id="count-proj",
            nodes=[
                make_node_data("n1", question="Q1"),
                make_node_data("n2", parent_id="n1", question="Q2", node_type="branch"),
            ],
        )
        client.post("/api/v1/projects/save", json=save_data)

        client.delete("/api/v1/projects/count-proj/nodes/n2")

        get_response = client.get("/api/v1/projects/count-proj")
        project = get_response.json()
        assert len(project["nodes"]) == 1
        assert project["nodes"][0]["id"] == "n1"

    def test_delete_node_deletes_descendants_and_edges(self, client):
        save_data = make_project_data(
            project_id="cascade-delete-proj",
            nodes=[
                make_node_data("root", question="Root"),
                make_node_data("child", parent_id="root", question="Child", node_type="branch"),
                make_node_data("grandchild", parent_id="child", question="Grandchild", node_type="branch"),
                make_node_data("sibling", parent_id="root", question="Sibling", node_type="branch"),
            ],
            edges=[
                {"id": "edge-root-child", "source": "root", "target": "child"},
                {"id": "edge-child-grandchild", "source": "child", "target": "grandchild"},
                {"id": "edge-root-sibling", "source": "root", "target": "sibling"},
            ],
        )
        client.post("/api/v1/projects/save", json=save_data)

        response = client.delete("/api/v1/projects/cascade-delete-proj/nodes/child")

        assert response.status_code == 200
        assert response.json()["deletedNodeIds"] == ["child", "grandchild"]

        get_response = client.get("/api/v1/projects/cascade-delete-proj")
        project = get_response.json()
        assert {node["id"] for node in project["nodes"]} == {"root", "sibling"}
        assert [edge["id"] for edge in project["edges"]] == ["edge-root-sibling"]
        root = next(node for node in project["nodes"] if node["id"] == "root")
        assert root["data"]["childrenCount"] == 1


class TestCrossProjectNodeIdConflict:
    def test_save_project_with_conflicting_node_id(self, client):
        save_data_a = make_project_data(
            project_id="project-a",
            title="Project A",
            nodes=[make_node_data("shared-node-id", question="Node in A")],
        )
        response = client.post("/api/v1/projects/save", json=save_data_a)
        assert response.status_code == 200

        save_data_b = make_project_data(
            project_id="project-b",
            title="Project B",
            nodes=[make_node_data("shared-node-id", question="Node in B")],
        )
        response = client.post("/api/v1/projects/save", json=save_data_b)
        assert response.status_code == 200

        get_a = client.get("/api/v1/projects/project-a")
        assert get_a.status_code == 200
        project_a = get_a.json()
        assert len(project_a["nodes"]) == 1
        assert project_a["nodes"][0]["id"] == "shared-node-id"
        assert project_a["nodes"][0]["data"]["question"] == "Node in A"

        get_b = client.get("/api/v1/projects/project-b")
        assert get_b.status_code == 200
        project_b = get_b.json()
        assert len(project_b["nodes"]) == 1
        assert project_b["nodes"][0]["data"]["question"] == "Node in B"
        assert project_b["nodes"][0]["id"].startswith("shared-node-id-")

    def test_save_project_no_conflict_different_ids(self, client):
        save_data_a = make_project_data(
            project_id="proj-x",
            title="Project X",
            nodes=[make_node_data("unique-id-x", question="X Node")],
        )
        client.post("/api/v1/projects/save", json=save_data_a)

        save_data_b = make_project_data(
            project_id="proj-y",
            title="Project Y",
            nodes=[make_node_data("unique-id-y", question="Y Node")],
        )
        client.post("/api/v1/projects/save", json=save_data_b)

        get_x = client.get("/api/v1/projects/proj-x")
        assert get_x.status_code == 200
        assert len(get_x.json()["nodes"]) == 1
        assert get_x.json()["nodes"][0]["id"] == "unique-id-x"

        get_y = client.get("/api/v1/projects/proj-y")
        assert get_y.status_code == 200
        assert len(get_y.json()["nodes"]) == 1
        assert get_y.json()["nodes"][0]["id"] == "unique-id-y"
