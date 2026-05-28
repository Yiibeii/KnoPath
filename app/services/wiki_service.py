import asyncio
import json
import os
import re
import uuid
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from sqlalchemy.orm import Session
from jinja2 import Environment, FileSystemLoader, select_autoescape
from models import WikiPage, WikiLink, WikiPageSource, Node, Project
from schemas import WikiPageBase, WikiLinkBase, WikiGraphData
from logger import get_logger
from config import get_storage_path, BASE_DIR, get_global_settings
from services.file_storage import parse_markdown
from services.wiki.llm_client import call_openai_compatible
from services.log_service import append_log_entry

logger = get_logger('wiki_service')

PROMPT_DIR = os.path.join(BASE_DIR, "prompt")
_jinja_env = Environment(
    loader=FileSystemLoader(PROMPT_DIR),
    autoescape=select_autoescape(),
)


def _load_prompt_template(template_name: str) -> str:
    return _jinja_env.get_template(template_name).render()


WIKI_PAGE_GENERATION_PROMPT = _load_prompt_template("wiki_page_generation.jinja2")
WIKI_COMPILE_SYSTEM_PROMPT = _load_prompt_template("wiki_compile_system.jinja2") 
INSIGHT_SYNC_TIMESTAMP_TOLERANCE = timedelta(seconds=5)


def sanitize_wiki_filename(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*`\u0000-\u001F]', '', value).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned[:48] or 'Untitled'


def _wiki_dir(project_title: str) -> str:
    return os.path.join(get_storage_path(), "wiki", sanitize_wiki_filename(project_title))


def _get_knowledge_base_templates(settings: dict | None = None) -> dict[str, str]:
    resolved_settings = settings or get_global_settings()
    kb_config = resolved_settings.get("knowledgeBase", {}) if isinstance(resolved_settings, dict) else {}
    templates = kb_config.get("templates", {}) if isinstance(kb_config, dict) else {}
    if not isinstance(templates, dict):
        return {}
    return {
        "readme": str(templates.get("readme") or ""),
        "claude": str(templates.get("claude") or ""),
        "index": str(templates.get("index") or ""),
    }


def _render_template(template: str, variables: dict[str, str | int]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", str(value))
    return rendered


def _wiki_page_markdown_link(project_title: str, page: WikiPage) -> str:
    filename = f"{sanitize_wiki_filename(page.title)}.md"
    project_dir = sanitize_wiki_filename(project_title)
    summary = (page.summary or "").strip()
    suffix = f": {summary}" if summary else ""
    return f"- [[wiki/{project_dir}/{filename}|{page.title}]]{suffix}"


def _build_wiki_links_block(project_title: str, pages: list[WikiPage]) -> str:
    if not pages:
        return "- No wiki pages yet."
    return "\n".join(_wiki_page_markdown_link(project_title, page) for page in pages)


def _write_text_file(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def write_knowledge_base_template_files(project_title: str, pages: list[WikiPage], now: datetime) -> None:
    """Write user-editable knowledge base templates into the repository root."""
    storage_root = get_storage_path()
    if not storage_root:
        return

    templates = _get_knowledge_base_templates()
    variables = {
        "updatedAt": now.isoformat(),
        "projectTitle": project_title,
        "wikiLinks": _build_wiki_links_block(project_title, pages),
        "count": len(pages),
        "plural": "" if len(pages) == 1 else "s",
    }

    readme = templates.get("readme", "").strip()
    if readme:
        _write_text_file(os.path.join(storage_root, "README.md"), _render_template(readme, variables))

    claude = templates.get("claude", "").strip()
    if claude:
        _write_text_file(os.path.join(storage_root, "CLAUDE.md"), _render_template(claude, variables))

    index_template = templates.get("index", "").strip()
    if index_template:
        _write_text_file(os.path.join(storage_root, "index.md"), _render_template(index_template, variables))


def save_wiki_page_file(page: WikiPage, project_title: str) -> str:
    wiki_dir = _wiki_dir(project_title)
    os.makedirs(wiki_dir, exist_ok=True)
    filename = f"{sanitize_wiki_filename(page.title)}.md"
    filepath = os.path.join(wiki_dir, filename)

    source_refs = json.loads(page.source_references) if page.source_references else []
    related = json.loads(page.related_topics) if page.related_topics else []
    questions = json.loads(page.questions) if page.questions else []

    frontmatter = [
        "---",
        f"id: {page.id}",
        f"title: {page.title}",
        f"canonical_title: {page.canonical_title or page.title}",
        f"status: {page.status or 'draft'}",
        f"sensitivity: {page.sensitivity or 'internal'}",
        f"source_node_id: {page.source_node_id or ''}",
        f"source_project_id: {page.source_project_id or ''}",
        f"source_count: {len(source_refs)}",
        f"tags: {page.tags or '[]'}",
        f"compiled_at: {page.compiled_at.isoformat() if page.compiled_at else ''}",
        "---",
    ]

    content_parts = ["\n".join(frontmatter)]

    if page.summary:
        content_parts.append(f"\n## 摘要\n\n{page.summary}")

    if page.content:
        content_parts.append(f"\n## 核心内容\n\n{page.content}")

    if source_refs:
        refs_text = "\n".join(f"- {ref}" for ref in source_refs)
        content_parts.append(f"\n## 引用来源\n\n{refs_text}")

    if related:
        related_text = "\n".join(f"- [[{topic}]]" for topic in related)
        content_parts.append(f"\n## 关联页面\n\n{related_text}")

    if questions:
        questions_text = "\n".join(f"- {q}" for q in questions)
        content_parts.append(f"\n## 待补充/疑问\n\n{questions_text}")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(content_parts))

    from file_watcher import get_file_watcher
    watcher = get_file_watcher()
    if watcher:
        watcher.add_cooldown(filepath)

    logger.debug(f"Saved wiki page file: {filepath}")
    return filepath


def delete_wiki_page_file(page: WikiPage, project_title: str) -> bool:
    wiki_dir = _wiki_dir(project_title)
    if not os.path.exists(wiki_dir):
        logger.warning(f"Wiki directory not found: {wiki_dir}")
        return False

    filename = f"{sanitize_wiki_filename(page.title)}.md"
    filepath = os.path.join(wiki_dir, filename)
    logger.info(f"[DELETE_WIKI] Attempting to delete wiki file: {filepath}")

    if os.path.exists(filepath):
        os.remove(filepath)
        logger.info(f"Deleted wiki page file: {filepath}")
        _cleanup_empty_wiki_dir(wiki_dir)
        return True

    for f in os.listdir(wiki_dir):
        if not f.endswith('.md'):
            continue
        fpath = os.path.join(wiki_dir, f)
        try:
            with open(fpath, 'r', encoding='utf-8') as fh:
                content = fh.read()
            frontmatter, _, _ = parse_markdown(content)
            if frontmatter.get('id') == page.id:
                os.remove(fpath)
                logger.info(f"Deleted wiki page file by frontmatter id: {fpath}")
                _cleanup_empty_wiki_dir(wiki_dir)
                return True
        except Exception as e:
            logger.warning(f"Failed to parse wiki file {f}: {e}")

    logger.warning(f"Wiki file not found for page id={page.id}, title={page.title}")
    return False


def _cleanup_empty_wiki_dir(wiki_dir: str) -> None:
    if os.path.exists(wiki_dir):
        remaining = [f for f in os.listdir(wiki_dir) if f.endswith('.md')]
        if not remaining:
            os.rmdir(wiki_dir)
            logger.info(f"Removed empty wiki directory: {wiki_dir}")


def delete_wiki_project_dir(project_title: str) -> bool:
    wiki_dir = _wiki_dir(project_title)
    if os.path.exists(wiki_dir):
        import shutil
        shutil.rmtree(wiki_dir)
        logger.info(f"Deleted wiki project directory: {wiki_dir}")
        return True
    return False


def _json_list_from_frontmatter(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return [item.strip() for item in value.split(",") if item.strip()]


def _parse_markdown_list(value: str | None) -> list[str]:
    if not value:
        return []
    items = []
    for line in value.splitlines():
        cleaned = line.strip()
        if cleaned.startswith("- "):
            cleaned = cleaned[2:].strip()
        if not cleaned:
            continue
        wiki_link = re.fullmatch(r"\[\[(.+?)\]\]", cleaned)
        items.append(wiki_link.group(1).strip() if wiki_link else cleaned)
    return items


def _parse_wiki_page_file(filepath: str, project_title: str, db: Session) -> WikiPage:
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    frontmatter, sections, title_from_body = parse_markdown(content)
    page_title = frontmatter.get("title") or title_from_body or os.path.splitext(os.path.basename(filepath))[0]
    canonical_title = frontmatter.get("canonical_title") or None
    source_project_id = frontmatter.get("source_project_id") or None
    source_node_id = frontmatter.get("source_node_id") or None

    project = None
    if source_project_id:
        project = db.query(Project).filter(Project.id == source_project_id).first()
    if not project:
        project = db.query(Project).filter(Project.title == project_title).first()
        source_project_id = project.id if project else None

    if source_node_id:
        node_query = db.query(Node).filter(Node.id == source_node_id)
        if source_project_id:
            node_query = node_query.filter(Node.project_id == source_project_id)
        if not node_query.first():
            source_node_id = None

    compiled_at = None
    if frontmatter.get("compiled_at"):
        try:
            compiled_at = datetime.fromisoformat(frontmatter["compiled_at"].replace("Z", "+00:00"))
        except ValueError:
            compiled_at = None

    now = datetime.now(timezone.utc)
    summary = sections.get("摘要", sections.get("Summary", ""))
    body = sections.get("核心内容", sections.get("Content", sections.get("Core Content", "")))
    source_refs = _parse_markdown_list(sections.get("引用来源", sections.get("Source References", "")))
    related_topics = _parse_markdown_list(sections.get("关联页面", sections.get("Related Topics", "")))
    questions = _parse_markdown_list(sections.get("待补充/疑问", sections.get("Questions", "")))

    return WikiPage(
        id=frontmatter.get("id") or str(uuid.uuid4()),
        title=page_title,
        canonical_title=canonical_title,
        content=body,
        status=frontmatter.get("status") or "draft",
        sensitivity=frontmatter.get("sensitivity") or "internal",
        summary=summary,
        source_references=json.dumps(source_refs, ensure_ascii=False),
        related_topics=json.dumps(related_topics, ensure_ascii=False),
        questions=json.dumps(questions, ensure_ascii=False),
        source_node_id=source_node_id,
        source_project_id=source_project_id,
        tags=json.dumps(_json_list_from_frontmatter(frontmatter.get("tags")), ensure_ascii=False),
        compiled_at=compiled_at or now,
        updated_at=now,
    )


def sync_wiki_pages_from_files(db: Session) -> WikiGraphData:
    wiki_root = os.path.join(get_storage_path(), "wiki")

    file_pages: list[WikiPage] = []
    if os.path.isdir(wiki_root):
        for project_name in os.listdir(wiki_root):
            project_path = os.path.join(wiki_root, project_name)
            if not os.path.isdir(project_path):
                continue
            for root, _, files in os.walk(project_path):
                for filename in files:
                    if not filename.endswith(".md"):
                        continue
                    filepath = os.path.join(root, filename)
                    try:
                        page = _parse_wiki_page_file(filepath, project_name, db)
                        file_pages.append(page)
                    except Exception as e:
                        logger.warning(f"Failed to parse wiki file {filepath}: {e}")

    file_page_ids = set()
    seen_ids: dict[str, WikiPage] = {}
    deduped_pages: list[WikiPage] = []
    for page in file_pages:
        if page.id in seen_ids:
            logger.warning(f"Duplicate wiki page id '{page.id}' in files, keeping last: '{page.title}'")
            deduped_pages.remove(seen_ids[page.id])
        seen_ids[page.id] = page
        deduped_pages.append(page)
        file_page_ids.add(page.id)

    existing_pages = db.query(WikiPage).all()
    existing_page_map = {p.id: p for p in existing_pages}

    pages_to_remove = [pid for pid in existing_page_map if pid not in file_page_ids]
    if pages_to_remove:
        db.query(WikiLink).filter(
            (WikiLink.source_page_id.in_(pages_to_remove)) | (WikiLink.target_page_id.in_(pages_to_remove))
        ).delete(synchronize_session=False)
        db.query(WikiPage).filter(WikiPage.id.in_(pages_to_remove)).delete(synchronize_session=False)
        logger.info(f"Removed {len(pages_to_remove)} wiki pages no longer in files")

    for page in deduped_pages:
        existing = existing_page_map.get(page.id)
        if existing:
            existing.title = page.title
            existing.canonical_title = page.canonical_title or existing.canonical_title
            existing.content = page.content or existing.content
            existing.status = page.status
            existing.sensitivity = page.sensitivity
            existing.summary = page.summary or existing.summary
            existing.source_references = page.source_references
            existing.related_topics = page.related_topics
            existing.questions = page.questions
            existing.source_node_id = page.source_node_id or existing.source_node_id
            existing.source_project_id = page.source_project_id or existing.source_project_id
            existing.tags = page.tags
            existing.compiled_at = page.compiled_at or existing.compiled_at
            existing.updated_at = page.updated_at
        else:
            db.add(page)

    db.flush()

    db.query(WikiLink).delete(synchronize_session=False)
    page_by_title = {p.title.lower(): p for p in deduped_pages}
    for page in deduped_pages:
        related_topics = json.loads(page.related_topics) if page.related_topics else []
        for topic in related_topics:
            target_page = page_by_title.get(str(topic).lower().strip())
            if target_page and target_page.id != page.id:
                db.add(WikiLink(
                    id=str(uuid.uuid4()),
                    source_page_id=page.id,
                    target_page_id=target_page.id,
                    link_type="reference",
                    context=f"Related topic: {topic}",
                ))

    db.commit()

    return get_wiki_graph(db)


def wiki_page_to_schema(page: WikiPage) -> WikiPageBase:
    tags = json.loads(page.tags) if page.tags else []
    source_refs = json.loads(page.source_references) if page.source_references else []
    related = json.loads(page.related_topics) if page.related_topics else []
    questions = json.loads(page.questions) if page.questions else []
    source_node_ids = [s.node_id for s in page.source_nodes if s.node_id] if page.source_nodes else []
    if page.source_node_id and page.source_node_id not in source_node_ids:
        source_node_ids.insert(0, page.source_node_id)
    return WikiPageBase(
        id=page.id,
        title=page.title,
        canonicalTitle=page.canonical_title,
        content=page.content,
        status=page.status or "draft",
        sensitivity=page.sensitivity or "internal",
        summary=page.summary,
        sourceReferences=source_refs,
        relatedTopics=related,
        questions=questions,
        sourceNodeId=page.source_node_id,
        sourceNodeIds=source_node_ids,
        sourceProjectId=page.source_project_id,
        tags=tags,
        compiledAt=page.compiled_at.isoformat() if page.compiled_at else None,
        updatedAt=page.updated_at.isoformat() if page.updated_at else None,
    )


def wiki_link_to_schema(link: WikiLink) -> WikiLinkBase:
    return WikiLinkBase(
        id=link.id,
        sourcePageId=link.source_page_id,
        targetPageId=link.target_page_id,
        linkType=link.link_type,
        context=link.context,
    )


def build_wiki_page_prompt(
    node: Node,
    project: Project,
    db: Session,
    existing_wiki_ctx: list[dict] | None = None,
    settings: dict | None = None,
) -> str:
    # 1. Ancestor chain (root → parent)
    ancestors = []
    current = node
    while current.parent_id:
        parent = db.query(Node).filter(Node.id == current.parent_id).first()
        if parent:
            ancestors.insert(0, {
                "question": parent.question,
                "summary": parent.summary,
            })
            current = parent
        else:
            break

    # 2. Sibling conclusions (marked nodes at same level)
    siblings = db.query(Node).filter(
        Node.parent_id == node.parent_id,
        Node.id != node.id,
        Node.is_marked == True,
    ).all()
    sibling_conclusions = [
        {"question": s.question, "summary": s.summary}
        for s in siblings
    ]

    # 3. Existing pages in this project
    existing_pages = []
    if existing_wiki_ctx:
        existing_pages = existing_wiki_ctx
    else:
        pages = db.query(WikiPage).filter(
            WikiPage.source_project_id == project.id,
        ).all()
        existing_pages = [
            {
                "title": p.title,
                "canonicalTitle": p.canonical_title or p.title,
                "summary": p.summary or "",
                "tags": json.loads(p.tags) if p.tags else [],
            }
            for p in pages
        ]

    # 4. Extract template rules from settings
    templates = _get_knowledge_base_templates(settings)
    readme_template = templates.get("readme", "")
    claude_template = templates.get("claude", "")

    # 5. Build prompt
    source_path = f"../raw/{sanitize_wiki_filename(project.title)}/{node.id[:8]}.md"

    prompt_data: dict = {
        "projectTitle": project.title,
        "ancestorChain": ancestors,
        "siblingConclusions": sibling_conclusions,
        "existingPages": existing_pages,
        "nodes": [
            {
                "nodeId": node.id,
                "question": node.question,
                "answer": node.answer,
                "summary": node.summary,
                "context": node.context,
                "sourcePath": source_path,
            }
        ],
    }

    if readme_template.strip():
        prompt_data["knowledgeBaseRules"] = readme_template.strip()
    if claude_template.strip():
        prompt_data["aiAssistantRules"] = claude_template.strip()

    return json.dumps(prompt_data, ensure_ascii=False, indent=2)


def _parse_llm_json(raw_response: str) -> dict:
    try:
        result = json.loads(raw_response)
    except json.JSONDecodeError:
        fence_match = raw_response.strip()
        if fence_match.startswith("```"):
            lines = fence_match.split("\n")
            lines = [line for line in lines if not line.strip().startswith("```")]
            result = json.loads("\n".join(lines))
        else:
            raise

    return result if isinstance(result, dict) else {}


def _fallback_wiki_result(node: Node, project_title: str) -> dict:
    title = node.summary or node.question or f"Insight {node.id[:8]}"
    content_parts = []
    if node.question:
        content_parts.append(f"## Question\n\n{node.question}")
    if node.answer:
        content_parts.append(f"## Answer\n\n{node.answer}")
    if node.summary:
        content_parts.append(f"## Summary\n\n{node.summary}")

    return {
        "pages": [
            {
                "title": title,
                "pageKind": "source_summary",
                "status": "draft",
                "sensitivity": "internal",
                "summary": node.summary or "",
                "content": "\n\n".join(content_parts),
                "sourceNodeId": node.id,
                "sourceReferences": [f"../raw/{sanitize_wiki_filename(project_title)}/{node.id[:8]}.md"],
                "relatedTopics": [],
                "questions": [],
                "tags": ["insight", "source_summary"],
            }
        ],
        "links": [],
    }


def _normalize_wiki_result(result: dict, default_node: Node | None, project_title: str) -> dict:
    if "pages" not in result and result.get("title"):
        result = {"pages": [result], "links": result.get("links", [])}

    pages = result.get("pages", [])
    if not isinstance(pages, list):
        pages = []

    normalized_pages = []
    for page_data in pages:
        if not isinstance(page_data, dict):
            continue

        source_node_id = page_data.get("sourceNodeId") or (default_node.id if default_node else None)
        source_refs = page_data.get("sourceReferences")
        if not isinstance(source_refs, list):
            source_refs = []
        if not source_refs and source_node_id:
            source_refs = [f"../raw/{sanitize_wiki_filename(project_title)}/{source_node_id[:8]}.md"]

        tags = page_data.get("tags")
        if not isinstance(tags, list):
            tags = ["insight"]
        page_kind = page_data.get("pageKind")
        if isinstance(page_kind, str) and page_kind and page_kind not in tags:
            tags.append(page_kind)

        canonical_title = page_data.get("canonicalTitle")
        if not isinstance(canonical_title, str) or not canonical_title:
            canonical_title = None

        normalized_pages.append({
            **page_data,
            "canonicalTitle": canonical_title,
            "sourceNodeId": source_node_id,
            "sourceReferences": source_refs,
            "relatedTopics": page_data.get("relatedTopics") if isinstance(page_data.get("relatedTopics"), list) else [],
            "questions": page_data.get("questions") if isinstance(page_data.get("questions"), list) else [],
            "tags": tags,
        })

    links = result.get("links", [])
    if not isinstance(links, list):
        links = []

    return {"pages": normalized_pages, "links": [link for link in links if isinstance(link, dict)]}


def _latest_datetime(values) -> datetime | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


def _node_changed_after_last_insight(node: Node) -> bool:
    if not node.insight_updated_at:
        return True
    if not node.updated_at or node.updated_at <= node.insight_updated_at:
        return False

    # SQLAlchemy onupdate also bumps updated_at when we only persist the
    # insight sync watermark. Treat that tiny internal timestamp drift as
    # unchanged, otherwise already-generated wiki pages are regenerated.
    return (node.updated_at - node.insight_updated_at) > INSIGHT_SYNC_TIMESTAMP_TOLERANCE


def _wiki_pages_up_to_date_for_node(node: Node, pages: list[WikiPage]) -> bool:
    if not pages:
        return False

    latest_page_update = _latest_datetime(page.updated_at for page in pages)
    if not latest_page_update:
        return False

    if node.insight_updated_at:
        return not _node_changed_after_last_insight(node) and latest_page_update >= node.insight_updated_at

    # Legacy data may have pages but no node watermark yet. Fall back to the
    # node/page timestamps so existing generated pages do not trigger LLM calls.
    return not node.updated_at or latest_page_update >= node.updated_at


def _mark_node_insight_synced(node: Node, synced_at: datetime) -> None:
    node.insight_updated_at = synced_at


async def generate_wiki_page_content(
    node: Node,
    project: Project,
    db: Session,
    model_config: dict,
    existing_wiki_ctx: list[dict] | None = None,
) -> dict:
    user_prompt = build_wiki_page_prompt(node, project, db, existing_wiki_ctx)

    logger.info(f"Generating wiki page for node: {node.id[:8]}")

    raw_response = await call_llm(WIKI_PAGE_GENERATION_PROMPT, user_prompt, model_config)

    try:
        result = _parse_llm_json(raw_response)
    except json.JSONDecodeError:
        logger.warning(f"LLM returned invalid JSON, using fallback: {raw_response[:200]}")
        return _fallback_wiki_result(node, project.title)

    normalized = _normalize_wiki_result(result, node, project.title)
    return normalized if normalized["pages"] else _fallback_wiki_result(node, project.title)


async def sync_wiki_pages_from_insights(
    db: Session,
    project_id: str,
    model_config: dict,
) -> WikiGraphData:
    from file_watcher import get_file_watcher

    watcher = get_file_watcher()
    if watcher:
        watcher.pause()
        logger.info("File watcher paused for wiki sync")

    try:
        return await _sync_wiki_pages_from_insights_impl(db, project_id, model_config)
    finally:
        if watcher:
            watcher.resume()
            logger.info("File watcher resumed after wiki sync")


async def _sync_wiki_pages_from_insights_impl(
    db: Session,
    project_id: str,
    model_config: dict,
) -> WikiGraphData:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project not found: {project_id}")

    marked_nodes = db.query(Node).filter(
        Node.project_id == project_id,
        Node.is_marked == True,
    ).all()

    now = datetime.now(timezone.utc)
    existing_wiki_ctx = _get_existing_wiki_context(db, project_id)
    all_affected_titles: list[str] = []
    total_saved = 0
    failed_nodes: list[dict] = []

    for i, node in enumerate(marked_nodes):
        existing_pages = db.query(WikiPage).filter(
            WikiPage.source_project_id == project_id,
            WikiPage.source_node_id == node.id,
        ).all()
        if _wiki_pages_up_to_date_for_node(node, existing_pages):
            for page in existing_pages:
                save_wiki_page_file(page, project.title)
            if not node.insight_updated_at:
                _mark_node_insight_synced(node, _latest_datetime(page.updated_at for page in existing_pages) or now)
            continue

        # Retry logic
        max_retries = 2
        wiki_data = None
        for attempt in range(max_retries + 1):
            try:
                wiki_data = await generate_wiki_page_content(node, project, db, model_config, existing_wiki_ctx)
                break  # success
            except Exception as e:
                logger.error(f"Failed to generate wiki page for node {node.id} (attempt {attempt + 1}): {e}")
                if attempt < max_retries:
                    await asyncio.sleep(1 * (attempt + 1))  # exponential backoff
                else:
                    wiki_data = _fallback_wiki_result(node, project.title)
                    failed_nodes.append({"node_id": node.id, "error": str(e)})

        if wiki_data is None:
            continue

        saved_pages, page_title_to_id = _save_generated_wiki_pages(
            db,
            project,
            wiki_data,
            {node.id: node},
            now,
        )
        _collect_pending_links(db, wiki_data.get("links", []), node.id, list(page_title_to_id.values()))

        if saved_pages:
            _mark_node_insight_synced(node, now)
            all_affected_titles.extend(p.title for p in saved_pages)
            total_saved += len(saved_pages)

    if failed_nodes:
        logger.warning(f"Failed to generate wiki for {len(failed_nodes)} nodes: {[f['node_id'][:8] for f in failed_nodes]}")

    db.commit()

    # Cleanup orphaned pages (nodes no longer marked)
    marked_node_ids = {n.id for n in marked_nodes}
    _cleanup_orphaned_pages(db, project_id, marked_node_ids)
    db.commit()

    # Post-sync maintenance: index, log, lint, and create links from relatedTopics
    if total_saved > 0:
        _update_wiki_index(db, project, now)
        _create_links_from_related_topics(db, project_id)
        append_log_entry(db, project_id, "sync", "Sync marked nodes",
                         page_titles=all_affected_titles)
        _lint_wiki_links(db, project.id)
        db.commit()

    return get_wiki_graph(db)


def _create_links_from_related_topics(db: Session, project_id: str) -> int:
    """Create WikiLink records from relatedTopics fields on wiki pages."""
    pages = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
    ).all()

    page_by_title = {p.title.lower(): p for p in pages}
    links_created = 0

    for page in pages:
        related_topics = json.loads(page.related_topics) if page.related_topics else []
        for topic in related_topics:
            topic_lower = str(topic).lower().strip()
            target_page = page_by_title.get(topic_lower)
            if target_page and target_page.id != page.id:
                # Check if link already exists
                existing = db.query(WikiLink).filter(
                    WikiLink.source_page_id == page.id,
                    WikiLink.target_page_id == target_page.id,
                ).first()
                if not existing:
                    db.add(WikiLink(
                        id=str(uuid.uuid4()),
                        source_page_id=page.id,
                        target_page_id=target_page.id,
                        link_type="reference",
                        context=f"Related topic: {topic}",
                    ))
                    links_created += 1

    if links_created > 0:
        logger.info(f"Created {links_created} wiki links from relatedTopics")

    return links_created


def get_wiki_graph(db: Session) -> WikiGraphData:
    from sqlalchemy import or_
    pages = db.query(WikiPage).filter(
        or_(
            WikiPage.canonical_title.is_(None),
            ~WikiPage.canonical_title.in_(["wiki-index", "wiki-log"]),
        )
    ).order_by(WikiPage.updated_at.desc()).all()
    links = db.query(WikiLink).all()
    return WikiGraphData(
        pages=[wiki_page_to_schema(p) for p in pages],
        links=[wiki_link_to_schema(l) for l in links],
    )


def get_project_wiki_pages(db: Session, project_id: str) -> List[WikiPageBase]:
    from sqlalchemy import or_
    pages = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
        or_(
            WikiPage.canonical_title.is_(None),
            ~WikiPage.canonical_title.in_(["wiki-index", "wiki-log"]),
        ),
    ).all()
    return [wiki_page_to_schema(p) for p in pages]


def delete_wiki_page(db: Session, page_id: str) -> bool:
    page = db.query(WikiPage).filter(WikiPage.id == page_id).first()
    if not page:
        return False

    project_title = "Unknown"
    if page.source_project_id:
        project = db.query(Project).filter(Project.id == page.source_project_id).first()
        if project:
            project_title = project.title

    if project_title == "Unknown":
        wiki_root = os.path.join(get_storage_path(), "wiki")
        if os.path.isdir(wiki_root):
            for project_name in os.listdir(wiki_root):
                project_path = os.path.join(wiki_root, project_name)
                if not os.path.isdir(project_path):
                    continue
                for filename in os.listdir(project_path):
                    if not filename.endswith('.md'):
                        continue
                    try:
                        with open(os.path.join(project_path, filename), 'r', encoding='utf-8') as fh:
                            content = fh.read()
                        frontmatter, _, _ = parse_markdown(content)
                        if frontmatter.get('id') == page.id:
                            project_title = project_name
                            break
                    except Exception:
                        continue
                if project_title != "Unknown":
                    break

    logger.info(f"[DELETE_WIKI] page_id={page_id}, project_title={project_title}")

    deleted_file = delete_wiki_page_file(page, project_title)

    if deleted_file:
        from file_watcher import get_file_watcher
        watcher = get_file_watcher()
        if watcher:
            wiki_dir = _wiki_dir(project_title)
            filepath = os.path.join(wiki_dir, f"{sanitize_wiki_filename(page.title)}.md")
            watcher.add_cooldown(filepath)

    db.query(WikiLink).filter(
        (WikiLink.source_page_id == page_id) | (WikiLink.target_page_id == page_id)
    ).delete(synchronize_session=False)
    db.delete(page)
    db.commit()

    if page.source_project_id:
        append_log_entry(db, page.source_project_id, "delete", f"Deleted: {page.title}")

    return True


async def call_llm(system_prompt: str, user_prompt: str, model_config: dict) -> str:
    return await call_openai_compatible(system_prompt, user_prompt, model_config)


def build_compile_prompt(wiki_pages: list[WikiPage]) -> str:
    pages_info = []
    for page in wiki_pages:
        pages_info.append({
            "id": page.id,
            "title": page.title,
            "content": (page.content or "")[:500],
            "tags": json.loads(page.tags) if page.tags else [],
        })

    prompt = {
        "wikiPages": pages_info,
    }

    return json.dumps(prompt, ensure_ascii=False, indent=2)


def build_legacy_compile_prompt(nodes: list[Node], project_title: str, existing_wiki_ctx: list[dict] | None = None) -> str:
    templates = _get_knowledge_base_templates()
    data = {
        "projectTitle": project_title,
        "nodes": [
            {
                "id": node.id,
                "question": node.question,
                "answer": node.answer,
                "summary": node.summary,
                "context": node.context,
            }
            for node in nodes
        ],
    }
    if existing_wiki_ctx:
        data["existingPages"] = existing_wiki_ctx
    if templates.get("readme", "").strip():
        data["knowledgeBaseRules"] = templates["readme"].strip()
    if templates.get("claude", "").strip():
        data["aiAssistantRules"] = templates["claude"].strip()
    return json.dumps(data, ensure_ascii=False, indent=2)


def _get_existing_wiki_context(db: Session, project_id: str) -> list[dict]:
    pages = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
    ).all()
    return [
        {
            "title": p.title,
            "canonicalTitle": p.canonical_title or p.title,
            "summary": p.summary or "",
            "tags": json.loads(p.tags) if p.tags else [],
        }
        for p in pages
    ]


def _json_list(value) -> str:
    return json.dumps(value if isinstance(value, list) else [], ensure_ascii=False)


def _save_generated_wiki_pages(
    db: Session,
    project: Project,
    result: dict,
    nodes_by_id: dict[str, Node],
    now: datetime,
) -> tuple[list[WikiPage], dict[str, str]]:
    saved_pages: list[WikiPage] = []
    page_title_to_id: dict[str, str] = {}

    normalized = _normalize_wiki_result(result, None, project.title)
    generated_titles = {p.get("title", "").lower() for p in normalized["pages"]}

    # Get existing pages for source nodes
    source_node_ids = list(nodes_by_id.keys())
    existing_pages = db.query(WikiPage).filter(
        WikiPage.source_project_id == project.id,
        WikiPage.source_node_id.in_(source_node_ids),
    ).all()
    existing_map = {p.title.lower(): p for p in existing_pages}

    # Track which existing pages were consumed (matched) during update
    consumed_titles: set[str] = set()

    for page_data in normalized["pages"]:
        title = page_data.get("title") or "Untitled"
        title_lower = title.lower()
        source_node_id = page_data.get("sourceNodeId")
        source_node = nodes_by_id.get(source_node_id) if source_node_id else None
        canonical_title = page_data.get("canonicalTitle")

        # Match by canonical_title first, then by title
        existing = None
        if canonical_title:
            existing = db.query(WikiPage).filter(
                WikiPage.source_project_id == project.id,
                WikiPage.canonical_title == canonical_title,
            ).first()
        if not existing:
            existing = existing_map.get(title_lower)

        tags = page_data.get("tags", ["insight"])
        source_refs = page_data.get("sourceReferences", [])

        if existing:
            # Clean up old file if title is changing
            if title.lower() != existing.title.lower():
                try:
                    delete_wiki_page_file(existing, project.title)
                except Exception as e:
                    logger.warning(f"Failed to delete old wiki file for {existing.title}: {e}")

            # Track the old title so we don't delete this page later
            consumed_titles.add(existing.title.lower())

            existing.title = title
            existing.canonical_title = canonical_title or existing.canonical_title
            existing.content = page_data.get("content", existing.content)
            existing.status = page_data.get("status", "draft")
            existing.sensitivity = page_data.get("sensitivity", "internal")
            existing.summary = page_data.get("summary", source_node.summary if source_node else existing.summary)
            existing.source_references = _json_list(source_refs)
            existing.related_topics = _json_list(page_data.get("relatedTopics", []))
            existing.questions = _json_list(page_data.get("questions", []))
            existing.tags = _json_list(tags)
            existing.source_node_id = source_node_id or existing.source_node_id
            existing.source_project_id = project.id
            existing.updated_at = now
            page = existing
        else:
            page = WikiPage(
                id=str(uuid.uuid4()),
                title=title,
                canonical_title=canonical_title,
                content=page_data.get("content", ""),
                status=page_data.get("status", "draft"),
                sensitivity=page_data.get("sensitivity", "internal"),
                summary=page_data.get("summary", source_node.summary if source_node else None),
                source_references=_json_list(source_refs),
                related_topics=_json_list(page_data.get("relatedTopics", [])),
                questions=_json_list(page_data.get("questions", [])),
                source_node_id=source_node_id,
                source_project_id=project.id,
                tags=_json_list(tags),
                compiled_at=now,
                updated_at=now,
            )
            db.add(page)
            db.flush()

        # Maintain WikiPageSource: record every contributing node
        if source_node_id and project.id:
            existing_source = db.query(WikiPageSource).filter(
                WikiPageSource.page_id == page.id,
                WikiPageSource.node_id == source_node_id,
            ).first()
            if not existing_source:
                db.add(WikiPageSource(
                    id=str(uuid.uuid4()),
                    page_id=page.id,
                    node_id=source_node_id,
                    project_id=project.id,
                ))

        save_wiki_page_file(page, project.title)
        saved_pages.append(page)
        page_title_to_id[title] = page.id

    # Remove pages no longer generated (hard delete)
    for title_lower, page in existing_map.items():
        if title_lower not in generated_titles and title_lower not in consumed_titles:
            # Delete related links first
            db.query(WikiLink).filter(
                (WikiLink.source_page_id == page.id) | (WikiLink.target_page_id == page.id)
            ).delete(synchronize_session=False)
            # Delete the page
            db.delete(page)
            # Delete file
            try:
                delete_wiki_page_file(page, project.title)
            except Exception as e:
                logger.warning(f"Failed to delete wiki file for {page.title}: {e}")

    return saved_pages, page_title_to_id


def _save_generated_wiki_links(db: Session, links: list[dict], page_title_to_id: dict[str, str]) -> int:
    if not page_title_to_id:
        return 0

    db.query(WikiLink).filter(
        WikiLink.source_page_id.in_(list(page_title_to_id.values()))
    ).delete(synchronize_session=False)

    created = 0
    for link_data in links:
        source_id = page_title_to_id.get(link_data.get("sourceTitle"))
        target_id = page_title_to_id.get(link_data.get("targetTitle"))
        if source_id and target_id and source_id != target_id:
            db.add(WikiLink(
                id=str(uuid.uuid4()),
                source_page_id=source_id,
                target_page_id=target_id,
                link_type=link_data.get("linkType", "reference"),
                context=link_data.get("context"),
            ))
            created += 1

    return created


def _collect_pending_links(db: Session, links: list[dict], source_node_id: str, page_ids: list[str]) -> None:
    """Store links as pending on the primary page for later compile phase."""
    if not page_ids or not links:
        return

    # Find the primary page (first page generated by this node)
    primary_page_id = page_ids[0]
    primary_page = db.query(WikiPage).filter(WikiPage.id == primary_page_id).first()
    if not primary_page:
        return

    # Parse existing pending links
    existing_pending = []
    if primary_page.pending_links:
        try:
            existing_pending = json.loads(primary_page.pending_links)
        except json.JSONDecodeError:
            logger.warning(f"Corrupted pending_links for page {primary_page.id}, resetting")
            existing_pending = []

    # Add new links with source_node_id
    for link in links:
        if not isinstance(link, dict):
            continue
        link_with_source = {
            **link,
            "sourceNodeId": source_node_id,
        }
        existing_pending.append(link_with_source)

    primary_page.pending_links = json.dumps(existing_pending, ensure_ascii=False)


def _cleanup_orphaned_pages(db: Session, project_id: str, marked_node_ids: set[str]) -> int:
    """Remove wiki pages whose source_node is no longer marked.

    Returns the number of pages removed.
    """
    from sqlalchemy import or_

    # Find pages whose source_node is not in the marked set
    orphaned = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
        WikiPage.source_node_id.isnot(None),
        ~WikiPage.source_node_id.in_(marked_node_ids),
    ).all()

    if not orphaned:
        return 0

    # Get project title for file deletion
    project = db.query(Project).filter(Project.id == project_id).first()
    project_title = project.title if project else "unknown"

    removed = 0
    for page in orphaned:
        # Skip internal pages
        if page.canonical_title in ("wiki-index", "wiki-log"):
            continue

        # Delete associated links
        db.query(WikiLink).filter(
            or_(WikiLink.source_page_id == page.id, WikiLink.target_page_id == page.id)
        ).delete(synchronize_session=False)

        # Delete the file
        try:
            delete_wiki_page_file(page, project_title)
        except Exception as e:
            logger.warning(f"Failed to delete wiki file for page {page.id}: {e}")

        db.delete(page)
        removed += 1

    if removed > 0:
        logger.info(f"Cleaned up {removed} orphaned wiki pages (nodes no longer marked)")

    return removed


def _get_page_kind_from_tags(tags: list[str]) -> str:
    """Extract page kind from tags (stored by _normalize_wiki_result)."""
    known_kinds = {"entity", "concept", "source_summary", "comparison", "question", "index", "log"}
    for tag in tags:
        if tag in known_kinds:
            return tag
    return "page"


def _update_wiki_index(db: Session, project: Project, now: datetime) -> WikiPage | None:
    """Generate or update a programmatic index page listing all wiki pages grouped by type."""
    from sqlalchemy import or_
    pages = db.query(WikiPage).filter(
        WikiPage.source_project_id == project.id,
        or_(
            WikiPage.canonical_title.is_(None),
            ~WikiPage.canonical_title.in_(["wiki-index", "wiki-log"]),
        ),
    ).order_by(WikiPage.title).all()
    if not pages:
        return None

    # Group by page kind
    groups: dict[str, list[WikiPage]] = {}
    for p in pages:
        tags = json.loads(p.tags) if p.tags else []
        kind = _get_page_kind_from_tags(tags)
        groups.setdefault(kind, []).append(p)

    wiki_links = _build_wiki_links_block(project.title, pages)
    index_template = _get_knowledge_base_templates().get("index", "").strip()

    lines = [f"# Wiki Index — {project.title}", ""]
    kind_labels = {
        "entity": "实体",
        "concept": "概念",
        "source_summary": "来源摘要",
        "comparison": "对比",
        "question": "疑问",
        "page": "其他",
    }

    for kind in ["entity", "concept", "source_summary", "comparison", "question", "page"]:
        group = groups.get(kind)
        if not group:
            continue
        label = kind_labels.get(kind, kind)
        lines.append(f"## {label} ({len(group)})")
        lines.append("")
        for p in group:
            summary = (p.summary or "")[:120]
            lines.append(f"- [[{p.title}]]: {summary}")
        lines.append("")

    fallback_content = "\n".join(lines)
    variables = {
        "updatedAt": now.isoformat(),
        "projectTitle": project.title,
        "wikiLinks": wiki_links,
        "count": len(pages),
        "plural": "" if len(pages) == 1 else "s",
    }
    content = _render_template(index_template, variables) if index_template else fallback_content

    # Upsert index page
    existing = db.query(WikiPage).filter(
        WikiPage.source_project_id == project.id,
        WikiPage.canonical_title == "wiki-index",
    ).first()

    tags_json = json.dumps(["index", "insight"], ensure_ascii=False)
    if existing:
        existing.title = "Wiki Index"
        existing.canonical_title = "wiki-index"
        existing.content = content
        existing.summary = f"Wiki index for {project.title} — {len(pages)} pages"
        existing.tags = tags_json
        existing.source_project_id = project.id
        existing.updated_at = now
        page = existing
    else:
        page = WikiPage(
            id=str(uuid.uuid4()),
            title="Wiki Index",
            canonical_title="wiki-index",
            content=content,
            status="draft",
            sensitivity="internal",
            summary=f"Wiki index for {project.title} — {len(pages)} pages",
            source_project_id=project.id,
            tags=tags_json,
            compiled_at=now,
            updated_at=now,
        )
        db.add(page)
        db.flush()

    save_wiki_page_file(page, project.title)
    write_knowledge_base_template_files(project.title, pages, now)
    return page


def _lint_wiki_links(db: Session, project_id: str) -> dict:
    from services.lint_service import lint_wiki
    result = lint_wiki(db, project_id, auto_fix=True)
    return result.to_dict()


async def compile_wiki_from_nodes(
    db: Session,
    project: Project,
    node_ids: list[str],
    model_config: dict,
) -> WikiGraphData:
    nodes = db.query(Node).filter(
        Node.project_id == project.id,
        Node.id.in_(node_ids),
    ).all()
    if not nodes:
        raise ValueError("No source nodes found for wiki compilation.")

    existing_wiki_ctx = _get_existing_wiki_context(db, project.id)

    raw_response = await call_llm(
        WIKI_PAGE_GENERATION_PROMPT,
        build_legacy_compile_prompt(nodes, project.title, existing_wiki_ctx),
        model_config,
    )

    try:
        result = _parse_llm_json(raw_response)
    except json.JSONDecodeError:
        raise ValueError(f"LLM returned invalid JSON: {raw_response[:200]}")

    node_by_id = {node.id: node for node in nodes}
    now = datetime.now(timezone.utc)

    result = _normalize_wiki_result(result, None, project.title)
    saved_pages, page_title_to_id = _save_generated_wiki_pages(db, project, result, node_by_id, now)
    _save_generated_wiki_links(db, result.get("links", []), page_title_to_id)

    for node in nodes:
        node.insight_updated_at = now
    db.commit()

    # Post-compile maintenance
    if saved_pages:
        _update_wiki_index(db, project, now)
        append_log_entry(db, project.id, "compile", "Compile from nodes",
                         page_titles=[p.title for p in saved_pages])
        _lint_wiki_links(db, project.id)
        db.commit()

    return get_wiki_graph(db)


async def compile_wiki(
    db: Session,
    project_id: str,
    model_config: dict,
    node_ids: list[str] | None = None,
) -> WikiGraphData:
    from file_watcher import get_file_watcher

    watcher = get_file_watcher()
    if watcher:
        watcher.pause()
        logger.info("File watcher paused for wiki compilation")

    try:
        return await _compile_wiki_impl(db, project_id, model_config, node_ids)
    finally:
        if watcher:
            watcher.resume()
            logger.info("File watcher resumed after wiki compilation")


async def _compile_wiki_impl(
    db: Session,
    project_id: str,
    model_config: dict,
    node_ids: list[str] | None = None,
) -> WikiGraphData:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project not found: {project_id}")

    if node_ids:
        return await compile_wiki_from_nodes(db, project, node_ids, model_config)

    wiki_pages = db.query(WikiPage).filter(WikiPage.source_project_id == project_id).all()
    if not wiki_pages:
        raise ValueError("No wiki pages found for compilation. Sync insights first.")

    user_prompt = build_compile_prompt(wiki_pages)

    logger.info(f"Calling LLM for wiki link compilation: {len(wiki_pages)} pages")

    raw_response = await call_llm(WIKI_COMPILE_SYSTEM_PROMPT, user_prompt, model_config)

    try:
        result = json.loads(raw_response)
    except json.JSONDecodeError:
        fence_match = raw_response.strip()
        if fence_match.startswith("```"):
            lines = fence_match.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            result = json.loads("\n".join(lines))
        else:
            raise ValueError(f"LLM returned invalid JSON: {raw_response[:200]}")

    page_title_to_id = {p.title: p.id for p in wiki_pages}

    db.query(WikiLink).filter(
        WikiLink.source_page_id.in_([p.id for p in wiki_pages])
    ).delete(synchronize_session=False)

    for link_data in result.get("links", []):
        source_id = page_title_to_id.get(link_data.get("sourceTitle"))
        target_id = page_title_to_id.get(link_data.get("targetTitle"))

        if source_id and target_id and source_id != target_id:
            link = WikiLink(
                id=str(uuid.uuid4()),
                source_page_id=source_id,
                target_page_id=target_id,
                link_type=link_data.get("linkType", "reference"),
                context=link_data.get("context"),
            )
            db.add(link)
            logger.debug(f"Created wiki link: {link_data.get('sourceTitle')} -> {link_data.get('targetTitle')}")

    db.commit()

    now = datetime.now(timezone.utc)
    marked_nodes = db.query(Node).filter(
        Node.project_id == project_id,
        Node.is_marked == True,
    ).all()
    for node in marked_nodes:
        node.insight_updated_at = now
    db.commit()

    return get_wiki_graph(db)


async def stream_sync_wiki_pages(
    db: Session,
    project_id: str,
    model_config: dict,
):
    from file_watcher import get_file_watcher

    # Pause file watcher to prevent wiki file writes from triggering sync loops
    watcher = get_file_watcher()
    if watcher:
        watcher.pause()
        logger.info("File watcher paused for wiki compilation")

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Project not found: {project_id}'})}\n\n"
            return

        project_title = project.title
        marked_nodes = db.query(Node).filter(
            Node.project_id == project_id,
            Node.is_marked == True,
        ).all()

        if not marked_nodes:
            yield f"data: {json.dumps({'type': 'error', 'message': 'No marked nodes found'})}\n\n"
            return

        total = len(marked_nodes)
        yield f"data: {json.dumps({'type': 'start', 'total': total, 'project': project_title})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return

    now = datetime.now(timezone.utc)
    generated_count = 0
    skipped_count = 0
    failed_nodes = []

    # Load existing wiki context for dedup
    existing_wiki_ctx = _get_existing_wiki_context(db, project_id)

    for index, node in enumerate(marked_nodes):
        node_label = node.summary or node.question or f"Node {node.id[:8]}"
        yield f"data: {json.dumps({'type': 'progress', 'index': index + 1, 'total': total, 'node': node_label, 'status': 'checking'})}\n\n"

        # Check if pages already exist and are up to date
        current_node = db.query(Node).filter(
            Node.id == node.id,
            Node.project_id == project_id,
        ).first()
        existing_pages = db.query(WikiPage).filter(
            WikiPage.source_project_id == project_id,
            WikiPage.source_node_id == node.id,
        ).all()
        if current_node and _wiki_pages_up_to_date_for_node(current_node, existing_pages):
            latest_page_update = _latest_datetime(page.updated_at for page in existing_pages)
            if not current_node.insight_updated_at and latest_page_update:
                _mark_node_insight_synced(current_node, latest_page_update)
                db.commit()
            for existing_page in existing_pages:
                save_wiki_page_file(existing_page, project_title)
                yield f"data: {json.dumps({'type': 'page', 'index': index + 1, 'total': total, 'title': existing_page.title, 'pageId': existing_page.id, 'summary': (existing_page.summary or '')[:100], 'status': 'skipped'})}\n\n"
            skipped_count += len(existing_pages)
            continue

        yield f"data: {json.dumps({'type': 'progress', 'index': index + 1, 'total': total, 'node': node_label, 'status': 'generating'})}\n\n"

        # Retry logic
        max_retries = 2
        wiki_data = None
        for attempt in range(max_retries + 1):
            try:
                project_obj_gen = db.query(Project).filter(Project.id == project_id).first()
                wiki_data = await generate_wiki_page_content(node, project_obj_gen, db, model_config, existing_wiki_ctx)
                break  # success
            except Exception as e:
                logger.error(f"Failed to generate wiki page for node {node.id} (attempt {attempt + 1}): {e}")
                if attempt < max_retries:
                    yield f"data: {json.dumps({'type': 'retry', 'node_id': node.id, 'attempt': attempt + 1, 'error': str(e)})}\n\n"
                    await asyncio.sleep(1 * (attempt + 1))
                else:
                    wiki_data = _fallback_wiki_result(node, project_title)
                    failed_nodes.append({"node_id": node.id, "error": str(e)})
                    yield f"data: {json.dumps({'type': 'node_failed', 'node_id': node.id, 'error': str(e)})}\n\n"

        if wiki_data is None:
            continue

        try:
            project_obj = db.query(Project).filter(Project.id == project_id).first()
            node_obj = db.query(Node).filter(Node.id == node.id).first()
            if not project_obj or not node_obj:
                raise ValueError("Project or node disappeared during wiki sync")

            saved_pages, page_title_to_id = _save_generated_wiki_pages(
                db,
                project_obj,
                wiki_data,
                {node_obj.id: node_obj},
                now,
            )
            _collect_pending_links(db, wiki_data.get("links", []), node.id, list(page_title_to_id.values()))

            node_obj = db.query(Node).filter(Node.id == node.id).first()
            if node_obj:
                _mark_node_insight_synced(node_obj, now)

            db.commit()

            # Capture page data before session closes
            saved_page_data = [
                {"title": p.title, "id": p.id, "summary": p.summary or ""}
                for p in saved_pages
            ]
            generated_count += len(saved_pages)
        except Exception as e:
            logger.error(f"Database error for node {node.id}: {e}")
            db.rollback()
            saved_page_data = []
            failed_nodes.append({"node_id": node.id, "error": f"DB write failed: {e}"})

        for page_data in saved_page_data:
            yield f"data: {json.dumps({'type': 'page', 'index': index + 1, 'total': total, 'title': page_data['title'], 'pageId': page_data['id'], 'summary': page_data['summary'][:100]})}\n\n"

    # Cleanup orphaned pages (nodes no longer marked)
    marked_node_ids = {n.id for n in marked_nodes}
    try:
        _cleanup_orphaned_pages(db, project_id, marked_node_ids)
        db.commit()
    except Exception as e:
        logger.error(f"Cleanup error: {e}")
        db.rollback()

    yield f"data: {json.dumps({'type': 'links', 'status': 'Building knowledge graph links...'})}\n\n"

    # Build links from pending_links
    try:
        all_pages = db.query(WikiPage).filter(
            WikiPage.source_project_id == project_id,
        ).all()
        page_by_title = {p.title.lower(): p for p in all_pages}

        links_created = 0
        for page in all_pages:
            if not page.pending_links:
                continue
            try:
                pending = json.loads(page.pending_links)
            except json.JSONDecodeError:
                continue

            for link_data in pending:
                source_page = page
                target_title = link_data.get("targetTitle", "").lower().strip()
                target_page = page_by_title.get(target_title)

                if target_page and source_page.id != target_page.id:
                    existing = db.query(WikiLink).filter(
                        WikiLink.source_page_id == source_page.id,
                        WikiLink.target_page_id == target_page.id,
                    ).first()

                    if not existing:
                        link = WikiLink(
                            id=str(uuid.uuid4()),
                            source_page_id=source_page.id,
                            target_page_id=target_page.id,
                            link_type=link_data.get("linkType", "reference"),
                            context=link_data.get("context"),
                        )
                        db.add(link)
                        links_created += 1

            # Clear pending_links after processing
            page.pending_links = None

        db.commit()
        if links_created > 0:
            logger.info(f"Created {links_created} wiki links from pending links")
    except Exception as e:
        logger.error(f"Error building wiki links: {e}")
        db.rollback()

    # Post-stream maintenance: index, log, lint
    if generated_count > 0 or skipped_count > 0:
        try:
            maint_project = db.query(Project).filter(Project.id == project_id).first()
            if maint_project:
                now_maint = datetime.now(timezone.utc)
                _update_wiki_index(db, maint_project, now_maint)
                if generated_count > 0:
                    append_log_entry(db, project_id, "sync", "Stream sync marked nodes",
                                     details=f"Generated {generated_count} pages, skipped {skipped_count} pages, {len(failed_nodes)} failures")
                _lint_wiki_links(db, project_id)
                db.commit()
        except Exception as e:
            logger.error(f"Maintenance error after stream sync: {e}")
            db.rollback()

    yield f"data: {json.dumps({'type': 'complete', 'success': generated_count, 'skipped': skipped_count, 'total': total, 'failed_nodes': failed_nodes})}\n\n"

    # Resume file watcher after wiki compilation
    if watcher:
        watcher.resume()
        logger.info("File watcher resumed after wiki compilation")
