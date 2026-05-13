from services.file_storage import (
    sanitize_filename,
    format_timestamp,
    format_timestamp_from_iso,
    parse_markdown,
    parse_node_from_markdown,
    build_node_content,
)
from schemas import NodeBase, NodeDataBase


class TestSanitizeFilename:
    def test_normal_string(self):
        assert sanitize_filename("Hello World") == "Hello World"

    def test_special_characters(self):
        result = sanitize_filename('test<>:"/\\|?*file')
        assert "<" not in result
        assert ">" not in result
        assert ":" not in result

    def test_long_string_truncated(self):
        result = sanitize_filename("a" * 100)
        assert len(result) <= 48

    def test_empty_string(self):
        result = sanitize_filename("")
        assert result == "Untitled"


class TestFormatTimestamp:
    def test_format_timestamp_returns_string(self):
        result = format_timestamp()
        assert len(result) == 14
        assert result.isdigit()

    def test_format_timestamp_from_iso(self):
        result = format_timestamp_from_iso("2024-01-15T10:30:00")
        assert result == "20240115103000"

    def test_format_timestamp_from_iso_with_z(self):
        result = format_timestamp_from_iso("2024-01-15T10:30:00Z")
        assert result == "20240115103000"

    def test_format_timestamp_from_iso_invalid(self):
        result = format_timestamp_from_iso("not-a-date")
        assert len(result) == 14


class TestParseMarkdown:
    def test_parse_basic_markdown(self):
        content = """---
id: test-id
parent_id: None
created: 2024-01-01T00:00:00
---

# Test Question

## Question
What is this?

## Answer
This is a test.

## Summary
A test summary.

## Context
Test context.
"""
        frontmatter, sections, title = parse_markdown(content)

        assert frontmatter["id"] == "test-id"
        assert frontmatter["parent_id"] == "None"
        assert title == "Test Question"
        assert "What is this?" in sections["Question"]
        assert "This is a test." in sections["Answer"]
        assert "A test summary." in sections["Summary"]
        assert "Test context." in sections["Context"]

    def test_parse_markdown_no_frontmatter(self):
        content = """# Hello

## Section1
Content 1

## Section2
Content 2
"""
        frontmatter, sections, title = parse_markdown(content)
        assert frontmatter == {}
        assert title == "Hello"
        assert "Content 1" in sections["Section1"]

    def test_parse_node_from_markdown(self):
        content = """---
id: node-123
parent_id: None
created: 2024-01-01T00:00:00
updated: 2024-01-02T00:00:00
---

# My Question

## Question
My Question

## Answer
My Answer

## Summary
My Summary

## Context
My Context
"""
        result = parse_node_from_markdown(content)
        assert result["id"] == "node-123"
        assert result["parentId"] is None
        assert result["question"] == "My Question"
        assert result["answer"] == "My Answer"
        assert result["summary"] == "My Summary"
        assert result["context"] == "My Context"

    def test_parse_node_parent_id_none_values(self):
        content = """---
id: node-456
parent_id: null
---

# Test

## Question
Test
"""
        result = parse_node_from_markdown(content)
        assert result["parentId"] is None

    def test_parse_node_with_parent(self):
        content = """---
id: child-node
parent_id: parent-node
---

# Child

## Question
Child Question
"""
        result = parse_node_from_markdown(content)
        assert result["parentId"] == "parent-node"


class TestBuildNodeContent:
    def test_build_node_content(self):
        node = NodeBase(
            id="test-node",
            type="knopath",
            position={"x": 100, "y": 200},
            width=290,
            height=380,
            data=NodeDataBase(
                parentId=None,
                type="root",
                question="What is AI?",
                answer="Artificial Intelligence",
                summary="AI summary",
                context="AI context",
                isMarked=False,
                isBranchCollapsed=False,
                isNodeCollapsed=False,
                childrenCount=0,
                createdAt="2024-01-01T00:00:00",
                updatedAt="2024-01-01T00:00:00",
            )
        )

        content = build_node_content(node, "Test Project", ["What is AI?"])

        assert "What is AI?" in content
        assert "Artificial Intelligence" in content
        assert "AI summary" in content
        assert "AI context" in content
        assert "Test Project" in content
        assert "parent_id: None" in content
