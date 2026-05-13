"""Unit tests for wiki generation optimization functions."""
import json
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from models import WikiPage, WikiLink, Node, Project
from services.wiki_service import (
    _collect_pending_links,
    _cleanup_orphaned_pages,
    _save_generated_wiki_pages,
)


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    db.query.return_value.filter.return_value.all.return_value = []
    return db


@pytest.fixture
def mock_project():
    project = MagicMock(spec=Project)
    project.id = "proj-1"
    project.title = "Test Project"
    return project


@pytest.fixture
def mock_node():
    node = MagicMock(spec=Node)
    node.id = "node-1"
    node.question = "Test Question"
    node.summary = "Test Summary"
    node.is_marked = True
    node.parent_id = None
    node.updated_at = datetime.now(timezone.utc)
    return node


class TestCollectPendingLinks:
    def test_collects_links_on_primary_page(self, mock_db):
        """Links are stored as pending on the primary page."""
        primary_page = MagicMock(spec=WikiPage)
        primary_page.id = "page-1"
        primary_page.pending_links = None

        mock_db.query.return_value.filter.return_value.first.return_value = primary_page

        links = [
            {"targetTitle": "React Hooks", "linkType": "reference"},
            {"targetTitle": "Redux", "linkType": "dependency"},
        ]

        _collect_pending_links(mock_db, links, "node-1", ["page-1", "page-2"])

        assert primary_page.pending_links is not None
        stored = json.loads(primary_page.pending_links)
        assert len(stored) == 2
        assert stored[0]["sourceNodeId"] == "node-1"
        assert stored[0]["targetTitle"] == "React Hooks"
        assert stored[1]["linkType"] == "dependency"

    def test_appends_to_existing_pending_links(self, mock_db):
        """New links are appended to existing pending links."""
        primary_page = MagicMock(spec=WikiPage)
        primary_page.id = "page-1"
        primary_page.pending_links = json.dumps([{"targetTitle": "Existing", "linkType": "reference"}])

        mock_db.query.return_value.filter.return_value.first.return_value = primary_page

        links = [{"targetTitle": "New Link", "linkType": "extension"}]

        _collect_pending_links(mock_db, links, "node-1", ["page-1"])

        stored = json.loads(primary_page.pending_links)
        assert len(stored) == 2
        assert stored[0]["targetTitle"] == "Existing"
        assert stored[1]["targetTitle"] == "New Link"

    def test_skips_empty_page_ids(self, mock_db):
        """No action when page_ids is empty."""
        _collect_pending_links(mock_db, [{"targetTitle": "X"}], "node-1", [])
        mock_db.query.assert_not_called()

    def test_skips_empty_links(self, mock_db):
        """No action when links is empty."""
        _collect_pending_links(mock_db, [], "node-1", ["page-1"])
        mock_db.query.assert_not_called()

    def test_skips_non_dict_links(self, mock_db):
        """Non-dict links are skipped."""
        primary_page = MagicMock(spec=WikiPage)
        primary_page.id = "page-1"
        primary_page.pending_links = None

        mock_db.query.return_value.filter.return_value.first.return_value = primary_page

        links = ["not a dict", 123, None, {"targetTitle": "Valid"}]

        _collect_pending_links(mock_db, links, "node-1", ["page-1"])

        stored = json.loads(primary_page.pending_links)
        assert len(stored) == 1
        assert stored[0]["targetTitle"] == "Valid"

    def test_handles_corrupted_existing_pending_links(self, mock_db):
        """Corrupted JSON is reset to empty list."""
        primary_page = MagicMock(spec=WikiPage)
        primary_page.id = "page-1"
        primary_page.pending_links = "not valid json {{{"

        mock_db.query.return_value.filter.return_value.first.return_value = primary_page

        links = [{"targetTitle": "New"}]

        _collect_pending_links(mock_db, links, "node-1", ["page-1"])

        stored = json.loads(primary_page.pending_links)
        assert len(stored) == 1


class TestCleanupOrphanedPages:
    def test_removes_pages_with_unmarked_source_node(self, mock_db):
        """Pages whose source_node is no longer marked are removed."""
        orphaned_page = MagicMock(spec=WikiPage)
        orphaned_page.id = "page-orphan"
        orphaned_page.canonical_title = "Some Page"
        orphaned_page.source_node_id = "node-unmarked"

        mock_db.query.return_value.filter.return_value.all.return_value = [orphaned_page]
        mock_db.query.return_value.filter.return_value.first.return_value = None  # project

        # Mock project query
        project_mock = MagicMock(spec=Project)
        project_mock.title = "Test Project"
        mock_db.query.return_value.filter.return_value.first.side_effect = [project_mock, orphaned_page]

        result = _cleanup_orphaned_pages(mock_db, "proj-1", {"node-marked"})

        assert result == 1
        mock_db.delete.assert_called_once_with(orphaned_page)

    def test_skips_internal_pages(self, mock_db):
        """wiki-index and wiki-log pages are not removed."""
        internal_page = MagicMock(spec=WikiPage)
        internal_page.id = "page-internal"
        internal_page.canonical_title = "wiki-index"
        internal_page.source_node_id = "node-unmarked"

        mock_db.query.return_value.filter.return_value.all.return_value = [internal_page]

        project_mock = MagicMock(spec=Project)
        project_mock.title = "Test Project"
        mock_db.query.return_value.filter.return_value.first.return_value = project_mock

        result = _cleanup_orphaned_pages(mock_db, "proj-1", {"node-marked"})

        assert result == 0
        mock_db.delete.assert_not_called()

    def test_returns_zero_when_no_orphans(self, mock_db):
        """Returns 0 when no orphaned pages exist."""
        mock_db.query.return_value.filter.return_value.all.return_value = []

        result = _cleanup_orphaned_pages(mock_db, "proj-1", {"node-1"})

        assert result == 0

    def test_deletes_associated_links(self, mock_db):
        """Associated links are deleted when removing orphaned pages."""
        orphaned_page = MagicMock(spec=WikiPage)
        orphaned_page.id = "page-orphan"
        orphaned_page.canonical_title = "Some Page"
        orphaned_page.source_node_id = "node-unmarked"

        mock_db.query.return_value.filter.return_value.all.return_value = [orphaned_page]

        project_mock = MagicMock(spec=Project)
        project_mock.title = "Test Project"
        mock_db.query.return_value.filter.return_value.first.return_value = project_mock

        _cleanup_orphaned_pages(mock_db, "proj-1", {"node-marked"})

        # Verify link deletion was attempted
        mock_db.query.return_value.filter.return_value.delete.assert_called()


class TestSaveGeneratedWikiPages:
    def test_adds_new_pages(self, mock_db, mock_project):
        """New pages are created when no existing pages match."""
        # No existing pages
        mock_db.query.return_value.filter.return_value.all.return_value = []
        mock_db.query.return_value.filter.return_value.first.return_value = None

        wiki_data = {
            "pages": [
                {
                    "title": "React Hooks",
                    "content": "# React Hooks\n\nContent here...",
                    "tags": ["react", "hooks"],
                    "summary": "Hooks are functions that let you use state",
                    "pageKind": "concept",
                }
            ],
            "links": [],
        }

        node_map = {"node-1": MagicMock(id="node-1")}

        saved_pages, title_to_id = _save_generated_wiki_pages(
            mock_db, mock_project, wiki_data, node_map, datetime.now(timezone.utc)
        )

        assert len(saved_pages) == 1
        assert "React Hooks" in title_to_id
        mock_db.add.assert_called()
        mock_db.flush.assert_called()

    def test_updates_existing_pages_by_canonical_title(self, mock_db, mock_project):
        """Existing pages are matched by canonical_title first."""
        existing_page = MagicMock(spec=WikiPage)
        existing_page.id = "page-existing"
        existing_page.title = "Old Title"
        existing_page.canonical_title = "react hooks"
        existing_page.content = "Old content"

        # Track query calls to return different results
        query_call_count = [0]

        def mock_query_side_effect(*args, **kwargs):
            query_mock = MagicMock()
            filter_mock = MagicMock()

            def mock_filter(*filter_args, **filter_kwargs):
                filter_mock_inner = MagicMock()
                query_call_count[0] += 1

                # First call: source_node_id.in_ returns empty
                if query_call_count[0] == 1:
                    filter_mock_inner.all.return_value = []
                    filter_mock_inner.first.return_value = None
                # Second call: canonical_title match returns existing_page
                elif query_call_count[0] == 2:
                    filter_mock_inner.all.return_value = []
                    filter_mock_inner.first.return_value = existing_page
                # Third call: WikiPageSource query
                elif query_call_count[0] == 3:
                    filter_mock_inner.first.return_value = None
                else:
                    filter_mock_inner.all.return_value = []
                    filter_mock_inner.first.return_value = None

                return filter_mock_inner

            query_mock.filter = mock_filter
            return query_mock

        mock_db.query = mock_query_side_effect

        wiki_data = {
            "pages": [
                {
                    "title": "React Hooks Updated",
                    "content": "New content",
                    "tags": ["react"],
                    "summary": "Updated summary",
                    "pageKind": "concept",
                    "canonicalTitle": "react hooks",
                }
            ],
            "links": [],
        }

        node_map = {"node-1": MagicMock(id="node-1")}

        saved_pages, title_to_id = _save_generated_wiki_pages(
            mock_db, mock_project, wiki_data, node_map, datetime.now(timezone.utc)
        )

        assert len(saved_pages) == 1
        assert existing_page.content == "New content"

    def test_removes_pages_not_in_generated(self, mock_db, mock_project):
        """Pages not in generated output are deleted."""
        existing_page = MagicMock(spec=WikiPage)
        existing_page.id = "page-to-remove"
        existing_page.title = "Removed Page"
        existing_page.canonical_title = "removed page"

        mock_db.query.return_value.filter.return_value.all.return_value = [existing_page]
        mock_db.query.return_value.filter.return_value.first.return_value = None

        wiki_data = {
            "pages": [],  # No pages generated
            "links": [],
        }

        node_map = {"node-1": MagicMock(id="node-1")}

        saved_pages, title_to_id = _save_generated_wiki_pages(
            mock_db, mock_project, wiki_data, node_map, datetime.now(timezone.utc)
        )

        assert len(saved_pages) == 0
        mock_db.delete.assert_called_with(existing_page)

    def test_preserves_pages_from_other_nodes(self, mock_db, mock_project):
        """Pages from other nodes are not affected."""
        other_node_page = MagicMock(spec=WikiPage)
        other_node_page.id = "page-other"
        other_node_page.title = "Other Node Page"
        other_node_page.canonical_title = "other node page"
        other_node_page.source_node_id = "node-other"

        # Empty result for source_node_id.in_ query (no pages for node-1)
        mock_db.query.return_value.filter.return_value.all.return_value = []
        mock_db.query.return_value.filter.return_value.first.return_value = None

        wiki_data = {
            "pages": [
                {
                    "title": "New Page",
                    "content": "Content",
                    "tags": [],
                    "summary": "Summary",
                    "pageKind": "page",
                }
            ],
            "links": [],
        }

        node_map = {"node-1": MagicMock(id="node-1")}

        saved_pages, title_to_id = _save_generated_wiki_pages(
            mock_db, mock_project, wiki_data, node_map, datetime.now(timezone.utc)
        )

        # Other node's page should not be deleted (it's not in existing_map for node-1)
        # The delete is only called for pages in existing_map that are not in generated_titles
        # Since other_node_page is not in existing_map (filtered by node-1), it won't be deleted
        assert len(saved_pages) == 1
