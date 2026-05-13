import json
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from models import WikiPage, Project
from logger import get_logger

logger = get_logger('log_service')


def append_log_entry(
    db: Session,
    project_id: str,
    operation: str,
    title: str,
    details: Optional[str] = None,
    page_titles: Optional[list[str]] = None,
    extra: Optional[dict] = None,
) -> Optional[WikiPage]:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        logger.warning(f"Project not found for log entry: {project_id}")
        return None

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%d %H:%M UTC")

    lines = [f"## {timestamp}", f"- **操作**: {operation}"]

    if title:
        lines.append(f"- **标题**: {title}")

    if details:
        lines.append(f"- **详情**: {details}")

    if page_titles:
        titles_str = ", ".join(f"[[{t}]]" for t in page_titles[:10])
        if len(page_titles) > 10:
            titles_str += f" 等共 {len(page_titles)} 页"
        lines.append(f"- **页面**: {titles_str}")

    if extra:
        for key, value in extra.items():
            lines.append(f"- **{key}**: {value}")

    entry = "\n".join(lines) + "\n\n"

    existing = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
        WikiPage.canonical_title == "wiki-log",
    ).first()

    tags_json = json.dumps(["log", "insight"], ensure_ascii=False)

    if existing:
        existing.content = (existing.content or "") + entry
        existing.canonical_title = "wiki-log"
        existing.tags = tags_json
        existing.source_project_id = project_id
        existing.updated_at = now
        page = existing
    else:
        header = f"# Change Log — {project.title}\n\n"
        page = WikiPage(
            id=str(uuid.uuid4()),
            title="Change Log",
            canonical_title="wiki-log",
            content=header + entry,
            status="draft",
            sensitivity="internal",
            summary=f"Change log for {project.title}",
            source_project_id=project_id,
            tags=tags_json,
            compiled_at=now,
            updated_at=now,
        )
        db.add(page)
        db.flush()

    from services.wiki_service import save_wiki_page_file
    save_wiki_page_file(page, project.title)
    return page


def read_log_entries(db: Session, project_id: str) -> list[dict]:
    page = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
        WikiPage.canonical_title == "wiki-log",
    ).first()

    if not page or not page.content:
        return []

    entries = []
    pattern = r"## (\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)\n((?:(?!## ).+\n)*)"

    for match in re.finditer(pattern, page.content):
        timestamp = match.group(1).strip()
        body = match.group(2).strip()

        entry: dict = {"timestamp": timestamp, "operation": "", "title": "", "details": "", "pageTitles": []}

        for line in body.splitlines():
            line = line.strip()
            if line.startswith("- **操作**:"):
                entry["operation"] = line.replace("- **操作**:", "").strip()
            elif line.startswith("- **标题**:"):
                entry["title"] = line.replace("- **标题**:", "").strip()
            elif line.startswith("- **详情**:"):
                entry["details"] = line.replace("- **详情**:", "").strip()
            elif line.startswith("- **页面**:"):
                pages_text = line.replace("- **页面**:", "").strip()
                page_titles = re.findall(r'\[\[(.+?)\]\]', pages_text)
                entry["pageTitles"] = page_titles

        entries.append(entry)

    return list(reversed(entries))


def read_all_logs(db: Session) -> list[dict]:
    log_pages = db.query(WikiPage).filter(
        WikiPage.canonical_title == "wiki-log",
    ).all()

    all_entries = []
    for page in log_pages:
        project = db.query(Project).filter(Project.id == page.source_project_id).first()
        project_title = project.title if project else "Unknown"

        entries = read_log_entries(db, page.source_project_id)
        for entry in entries:
            entry["projectId"] = page.source_project_id
            entry["projectTitle"] = project_title
        all_entries.extend(entries)

    all_entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return all_entries
