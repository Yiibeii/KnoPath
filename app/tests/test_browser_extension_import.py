"""测试浏览器扩展导出的JSON格式能否正确导入"""
import pytest
import json
import os


class TestBrowserExtensionImport:
    """测试浏览器扩展导出的JSON格式导入"""

    def test_import_knopath_format_with_nodes(self, client):
        """测试导入包含nodes字段的KnoPath格式"""
        browser_export = {
            "title": "Exported Chat",
            "model": "DeepSeek-V3",
            "platform": "DeepSeek",
            "time": "2026-05-13T07:17:51.987Z",
            "nodes": [
                {
                    "question": "什么是Docker?",
                    "answer": "Docker是一个开源的容器化平台...",
                    "time": "2026-05-13T07:17:51.986Z",
                    "model": "DeepSeek-V3"
                },
                {
                    "question": "如何安装Docker?",
                    "answer": "可以通过以下命令安装Docker...",
                    "time": "2026-05-13T07:18:00.000Z",
                    "model": "DeepSeek-V3"
                }
            ]
        }

        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Test Browser Import",
                "jsonData": browser_export
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Browser Import"
        assert data["nodeCount"] == 2

    def test_import_knopath_format_with_branches(self, client):
        """测试导入包含branches的KnoPath格式"""
        browser_export = {
            "title": "Chat with Branches",
            "model": "DeepSeek-V3",
            "platform": "DeepSeek",
            "time": "2026-05-13T07:17:51.987Z",
            "nodes": [
                {
                    "question": "问题1",
                    "answer": "回答1",
                    "time": "2026-05-13T07:17:51.986Z",
                    "model": "DeepSeek-V3",
                    "branches": [
                        {
                            "question": "问题1-分支1",
                            "answer": "回答1-分支1"
                        },
                        {
                            "question": "问题1-分支2",
                            "answer": "回答1-分支2"
                        }
                    ]
                }
            ]
        }

        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Test Branches",
                "jsonData": browser_export
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Branches"
        assert data["nodeCount"] == 1

    def test_import_simple_list_format(self, client):
        """测试导入简单的列表格式（向后兼容）"""
        simple_list = [
            {"user": "问题1", "assistant": "回答1"},
            {"user": "问题2", "assistant": "回答2"}
        ]

        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Test Simple List",
                "jsonData": simple_list
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Simple List"
        assert data["nodeCount"] == 2

    def test_import_conversations_format(self, client):
        """测试导入conversations格式（向后兼容）"""
        conversations_format = {
            "title": "Test Chat",
            "conversations": [
                {"question": "问题1", "answer": "回答1"},
                {"question": "问题2", "answer": "回答2"}
            ]
        }

        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Test Conversations",
                "jsonData": conversations_format
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Conversations"
        assert data["nodeCount"] == 2

    def test_import_empty_json_returns_400(self, client):
        """测试空JSON返回400错误"""
        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Empty",
                "jsonData": []
            }
        )
        assert response.status_code == 400

    def test_import_invalid_json_returns_422(self, client):
        """测试无效JSON类型返回422验证错误"""
        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Invalid",
                "jsonData": "not a list or dict"
            }
        )
        assert response.status_code == 422

    def test_import_actual_browser_extension_export(self, client):
        """测试导入实际的浏览器扩展导出文件"""
        export_path = os.path.join(
            os.path.dirname(__file__), '..', '..', 'chat-Exported-Chat-2026-05-121.json'
        )
        if not os.path.exists(export_path):
            pytest.skip("Export file not found")

        with open(export_path, 'r', encoding='utf-8') as f:
            browser_export = json.load(f)

        assert 'nodes' in browser_export
        assert len(browser_export['nodes']) > 0

        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Real Browser Export",
                "jsonData": browser_export
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Real Browser Export"
        assert data["nodeCount"] == len(browser_export['nodes'])

    def test_import_wrapped_knopath_format(self, client):
        """测试前端包装后的格式（dict被包在数组里）"""
        browser_export = {
            "title": "Exported Chat",
            "model": "DeepSeek-V3",
            "platform": "DeepSeek",
            "time": "2026-05-13T07:17:51.987Z",
            "nodes": [
                {
                    "question": "问题1",
                    "answer": "回答1",
                    "time": "2026-05-13T07:17:51.986Z",
                    "model": "DeepSeek-V3"
                }
            ]
        }
        # 前端 Toolbar.tsx:103 会把 dict 包装成 [dict]
        response = client.post(
            "/api/v1/projects/import-json",
            json={
                "title": "Wrapped Format",
                "jsonData": [browser_export]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Wrapped Format"
        assert data["nodeCount"] == 1
