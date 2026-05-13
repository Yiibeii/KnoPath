import os
import re
import json
import aiofiles
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from schemas import ProjectBase, NodeBase, FileContent
from logger import get_logger

logger = get_logger('file_storage')


def sanitize_filename(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\u0000-\u001F]', '', value).strip()
    return cleaned[:48] or 'Untitled'


def generate_unique_filename(base_title: str, timestamp: str, existing_files: set, node_id: str) -> str:
    safe_title = sanitize_filename(base_title)[:30] or 'Untitled'
    base_filename = f"{safe_title}-{timestamp}.md"
    
    if base_filename not in existing_files:
        return base_filename
    
    id_filename = f"{node_id}.md"
    if id_filename in existing_files:
        return id_filename
    
    counter = 1
    while True:
        numbered_filename = f"{safe_title}（{counter}）-{timestamp}.md"
        if numbered_filename not in existing_files:
            return numbered_filename
        counter += 1
        if counter > 1000:
            return f"{node_id}.md"


def format_timestamp(date=None) -> str:
    if date is None:
        date = datetime.now(timezone.utc)
    pad = lambda v: str(v).zfill(2)
    return f"{date.year}{pad(date.month)}{pad(date.day)}{pad(date.hour)}{pad(date.minute)}{pad(date.second)}"


def format_timestamp_from_iso(iso_str: str) -> str:
    try:
        if 'T' in iso_str:
            dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        else:
            dt = datetime.fromisoformat(iso_str)
        pad = lambda v: str(v).zfill(2)
        return f"{dt.year}{pad(dt.month)}{pad(dt.day)}{pad(dt.hour)}{pad(dt.minute)}{pad(dt.second)}"
    except Exception:
        return format_timestamp()


def parse_markdown(content: str) -> Tuple[dict, dict, str]:
    """
    Unified markdown parser. Returns (frontmatter, sections, title).
    Used by both file_storage and sync_service to avoid duplicate parsing.
    """
    lines = content.split('\n')

    frontmatter = {}
    body_start = 0

    if lines and lines[0] == '---':
        for i, line in enumerate(lines[1:], 1):
            if line == '---':
                body_start = i + 1
                break
            if ':' in line:
                key, value = line.split(':', 1)
                frontmatter[key.strip()] = value.strip()

    body = '\n'.join(lines[body_start:])

    title_match = re.search(r'^#\s+(.+)$', body, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else ''

    sections = {}
    current_section = None
    current_content = []

    for line in body.split('\n'):
        if line.startswith('## '):
            if current_section:
                sections[current_section] = '\n'.join(current_content).strip()
            current_section = line[3:].strip()
            current_content = []
        else:
            current_content.append(line)

    if current_section:
        sections[current_section] = '\n'.join(current_content).strip()

    return frontmatter, sections, title


def parse_node_from_markdown(content: str) -> Optional[dict]:
    frontmatter, sections, title = parse_markdown(content)

    parent_id = frontmatter.get('parent_id')
    if parent_id in ('None', 'null', ''):
        parent_id = None

    return {
        'id': frontmatter.get('id'),
        'parentId': parent_id,
        'question': sections.get('Question', title),
        'answer': sections.get('Answer', ''),
        'summary': sections.get('Summary', ''),
        'context': sections.get('Context', ''),
        'createdAt': frontmatter.get('created'),
        'updatedAt': frontmatter.get('updated'),
    }


def build_node_content(node: NodeBase, project_title: str, branch_path: List[str]) -> str:
    data = node.data
    now = datetime.now(timezone.utc).isoformat()
    return f"""---
id: {node.id}
project: {project_title}
parent_id: {data.parentId or 'None'}
branch_path: {json.dumps(branch_path, ensure_ascii=False)}
created: {data.createdAt or now}
updated: {data.updatedAt or now}
source: KnoPath
---

# {data.question or 'Untitled Node'}

## Question
{data.question or 'No question'}

## Answer
{data.answer or 'No answer yet'}

## Summary
{data.summary or 'No summary yet'}

## Context
{data.context or 'No context'}

## Metadata
- Type: {data.type}
- Marked: {data.isMarked}
- Children Count: {data.childrenCount}
"""


async def save_project_files(
    project: ProjectBase,
    base_path: str
) -> List[str]:
    saved_files = []

    raw_dir = os.path.join(base_path, "raw", sanitize_filename(project.title))
    os.makedirs(raw_dir, exist_ok=True)
    logger.debug(f"Saving project files to: {raw_dir}")

    node_map = {node.id: node for node in project.nodes}

    def get_branch_path(node_id: str) -> List[str]:
        path = []
        current = node_map.get(node_id)
        while current:
            path.insert(0, current.data.question or 'Untitled')
            if current.data.parentId:
                current = node_map.get(current.data.parentId)
            else:
                current = None
        return path

    existing_files = set()
    node_id_to_filename = {}
    
    if os.path.exists(raw_dir):
        for filename in os.listdir(raw_dir):
            if filename.endswith('.md'):
                existing_files.add(filename)
                filepath = os.path.join(raw_dir, filename)
                try:
                    async with aiofiles.open(filepath, 'r', encoding='utf-8') as f:
                        content = await f.read()
                    frontmatter, _, _ = parse_markdown(content)
                    file_node_id = frontmatter.get('id')
                    if file_node_id:
                        node_id_to_filename[file_node_id] = filename
                except Exception as e:
                    logger.warning(f"Failed to parse file {filename}: {e}")

    expected_filenames = set()
    node_to_filename = {}
    
    for node in project.nodes:
        timestamp = format_timestamp_from_iso(node.data.createdAt) if node.data.createdAt else format_timestamp()
        
        if node.id in node_id_to_filename:
            filename = node_id_to_filename[node.id]
        else:
            filename = generate_unique_filename(
                node.data.question or 'Untitled',
                timestamp,
                existing_files,
                node.id
            )
        
        node_to_filename[node.id] = filename
        expected_filenames.add(filename)
        existing_files.add(filename)

    if os.path.exists(raw_dir):
        for filename in list(existing_files):
            if filename.endswith('.md') and filename not in expected_filenames:
                filepath = os.path.join(raw_dir, filename)
                os.remove(filepath)
                logger.info(f"Removed orphaned file: {filepath}")

    new_count = 0
    update_count = 0
    for node in project.nodes:
        branch_path = get_branch_path(node.id)
        content = build_node_content(node, project.title, branch_path)

        filename = node_to_filename[node.id]
        filepath = os.path.join(raw_dir, filename)

        if os.path.exists(filepath):
            update_count += 1
        else:
            new_count += 1

        async with aiofiles.open(filepath, 'w', encoding='utf-8') as f:
            await f.write(content)

        saved_files.append(filepath)

    logger.info(f"Saved {len(saved_files)} files ({new_count} new, {update_count} updated)")
    return saved_files


async def read_project_files(
    project_dir: str
) -> List[FileContent]:
    files = []

    if not os.path.exists(project_dir):
        return files

    for filename in os.listdir(project_dir):
        if filename.endswith('.md'):
            filepath = os.path.join(project_dir, filename)
            async with aiofiles.open(filepath, 'r', encoding='utf-8') as f:
                content = await f.read()
            files.append(FileContent(path=filepath, content=content))

    return files


async def delete_node_file(node, project_title: str, base_path: str) -> Optional[str]:
    logger.info(f"[DELETE] Attempting to delete node file:")
    logger.info(f"[DELETE]   node.id: {node.id}")
    logger.info(f"[DELETE]   node.question: {node.question}")
    logger.info(f"[DELETE]   node.created_at: {node.created_at}")
    logger.info(f"[DELETE]   project_title: {project_title}")
    logger.info(f"[DELETE]   base_path: {base_path}")

    raw_dir = os.path.join(base_path, "raw", sanitize_filename(project_title))
    logger.info(f"[DELETE]   raw_dir: {raw_dir}")

    if not os.path.exists(raw_dir):
        logger.warning(f"[DELETE] Project directory not found: {raw_dir}")
        return None

    id_filename = f"{node.id}.md"
    id_filepath = os.path.join(raw_dir, id_filename)
    logger.info(f"[DELETE]   id_filename: {id_filename}")
    logger.info(f"[DELETE]   id_filepath: {id_filepath}")

    if os.path.exists(id_filepath):
        os.remove(id_filepath)
        logger.info(f"[DELETE] Successfully deleted file: {id_filepath}")
        return id_filepath

    for filename in os.listdir(raw_dir):
        if not filename.endswith('.md'):
            continue
        filepath = os.path.join(raw_dir, filename)
        try:
            async with aiofiles.open(filepath, 'r', encoding='utf-8') as f:
                content = await f.read()
            frontmatter, _, _ = parse_markdown(content)
            file_node_id = frontmatter.get('id')
            if file_node_id == node.id:
                os.remove(filepath)
                logger.info(f"[DELETE] Successfully deleted file by frontmatter id: {filepath}")
                return filepath
        except Exception as e:
            logger.warning(f"[DELETE] Failed to parse file {filename}: {e}")

    created_ts = format_timestamp_from_iso(node.created_at.isoformat()) if node.created_at else format_timestamp()
    safe_title = sanitize_filename(node.question or 'node')[:30]
    
    possible_filenames = [
        f"{safe_title}-{created_ts}.md",
        f"{created_ts}-{safe_title}.md",
    ]
    
    for fallback_filename in possible_filenames:
        fallback_filepath = os.path.join(raw_dir, fallback_filename)
        logger.info(f"[DELETE]   trying fallback_filename: {fallback_filename}")
        if os.path.exists(fallback_filepath):
            os.remove(fallback_filepath)
            logger.info(f"[DELETE] Successfully deleted file (fallback): {fallback_filepath}")
            return fallback_filepath

    logger.warning(f"[DELETE] File not found for node: {node.id}")
    logger.info(f"[DELETE] Listing files in directory: {raw_dir}")
    if os.path.exists(raw_dir):
        for f in os.listdir(raw_dir):
            logger.info(f"[DELETE]   - {f}")
    return None
