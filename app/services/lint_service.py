import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from models import WikiPage, WikiLink
from logger import get_logger

logger = get_logger('lint_service')


@dataclass
class LintResult:
    orphan_pages: list[dict[str, Any]] = field(default_factory=list)
    missing_links: list[dict[str, Any]] = field(default_factory=list)
    broken_links_removed: int = 0
    suggestions: list[str] = field(default_factory=list)
    page_count: int = 0
    link_count: int = 0

    @property
    def is_healthy(self) -> bool:
        return len(self.orphan_pages) == 0 and len(self.missing_links) == 0

    def to_dict(self) -> dict:
        return {
            "orphanPages": self.orphan_pages,
            "missingLinks": self.missing_links,
            "brokenLinksRemoved": self.broken_links_removed,
            "suggestions": self.suggestions,
            "pageCount": self.page_count,
            "linkCount": self.link_count,
            "isHealthy": self.is_healthy,
        }


def lint_wiki(db: Session, project_id: str, auto_fix: bool = True) -> LintResult:
    result = LintResult()

    project_pages = db.query(WikiPage).filter(
        WikiPage.source_project_id == project_id,
    ).all()

    result.page_count = len(project_pages)
    if not project_pages:
        result.suggestions.append("No wiki pages found. Compile insights first.")
        return result

    page_ids = {p.id for p in project_pages}
    page_by_title_lower: dict[str, WikiPage] = {}
    exclude_canonical = {"wiki-index", "wiki-log"}

    for p in project_pages:
        page_by_title_lower[p.title.lower()] = p

    all_links = db.query(WikiLink).filter(
        WikiLink.source_page_id.in_(page_ids),
    ).all()

    result.link_count = len(all_links)

    # 1. Remove broken links (source or target page no longer exists)
    broken = 0
    for link in all_links:
        if link.source_page_id not in page_ids or link.target_page_id not in page_ids:
            if auto_fix:
                db.delete(link)
            broken += 1
    result.broken_links_removed = broken

    # 2. Detect orphan pages (no inbound or outbound links)
    linked_page_ids: set[str] = set()
    for link in all_links:
        if link.source_page_id in page_ids and link.target_page_id in page_ids:
            linked_page_ids.add(link.source_page_id)
            linked_page_ids.add(link.target_page_id)

    for p in project_pages:
        if p.canonical_title in exclude_canonical:
            continue
        if p.id not in linked_page_ids:
            result.orphan_pages.append({
                "pageId": p.id,
                "title": p.title,
                "reason": "No inbound or outbound links to other pages",
            })

    # 3. Detect missing links (referenced in relatedTopics but page doesn't exist)
    for p in project_pages:
        if p.canonical_title in exclude_canonical:
            continue
        related_topics = json.loads(p.related_topics) if p.related_topics else []
        for topic in related_topics:
            topic_lower = str(topic).lower().strip()
            if topic_lower not in page_by_title_lower:
                result.missing_links.append({
                    "sourcePageId": p.id,
                    "sourceTitle": p.title,
                    "referencedTitle": topic,
                    "reason": f"Referenced in relatedTopics but no page exists with title '{topic}'",
                })

    # 4. Detect pages with empty content
    empty_content_pages = []
    for p in project_pages:
        if p.canonical_title in exclude_canonical:
            continue
        if not p.content or not p.content.strip():
            empty_content_pages.append(p.title)

    # 5. Detect pages without summary
    no_summary_pages = []
    for p in project_pages:
        if p.canonical_title in exclude_canonical:
            continue
        if not p.summary or not p.summary.strip():
            no_summary_pages.append(p.title)

    # 6. Auto-fix orphan pages by adding cross-references
    if auto_fix and result.orphan_pages:
        for orphan_info in result.orphan_pages:
            orphan_page = db.query(WikiPage).filter(WikiPage.id == orphan_info["pageId"]).first()
            if orphan_page:
                # Find a suitable page to link to (prefer pages with more links)
                linking_page = None
                for p in project_pages:
                    if p.id != orphan_page.id and p.id in linked_page_ids:
                        linking_page = p
                        break

                if linking_page:
                    # Add orphan page to linking page's related_topics
                    linking_related = json.loads(linking_page.related_topics) if linking_page.related_topics else []
                    if orphan_page.title not in linking_related:
                        linking_related.append(orphan_page.title)
                        linking_page.related_topics = json.dumps(linking_related, ensure_ascii=False)
                        db.flush()

    # 7. Auto-fix missing links by removing invalid references
    if auto_fix and result.missing_links:
        for missing_link in result.missing_links:
            source_page = db.query(WikiPage).filter(WikiPage.id == missing_link["sourcePageId"]).first()
            if source_page:
                related_topics = json.loads(source_page.related_topics) if source_page.related_topics else []
                if missing_link["referencedTitle"] in related_topics:
                    related_topics.remove(missing_link["referencedTitle"])
                    source_page.related_topics = json.dumps(related_topics, ensure_ascii=False)
                    db.flush()

    # 8. Generate suggestions
    if result.orphan_pages:
        result.suggestions.append(
            f"Consider adding cross-references to {len(result.orphan_pages)} orphan page(s)"
        )
    if result.missing_links:
        result.suggestions.append(
            f"Create {len(result.missing_links)} missing page(s) or update references"
        )
    if empty_content_pages:
        result.suggestions.append(
            f"{len(empty_content_pages)} page(s) have empty content"
        )
    if no_summary_pages:
        result.suggestions.append(
            f"{len(no_summary_pages)} page(s) are missing summaries"
        )
    if broken > 0:
        result.suggestions.append(
            f"Removed {broken} broken link(s)"
        )
    if result.is_healthy:
        result.suggestions.append("All wiki pages are healthy!")

    if auto_fix and broken > 0:
        db.flush()

    return result


def lint_all_projects(db: Session, auto_fix: bool = True) -> dict[str, LintResult]:
    from models import Project

    projects = db.query(Project).all()
    results: dict[str, LintResult] = {}

    for project in projects:
        pages = db.query(WikiPage).filter(
            WikiPage.source_project_id == project.id,
        ).count()
        if pages > 0:
            results[project.id] = lint_wiki(db, project.id, auto_fix)

    return results
