import type { Project, SearchResult, WikiPage, WikiSearchResult } from '../types'

function buildPreview(source: string, query: string): string {
  const normalizedSource = source.trim()
  if (!normalizedSource) return ''

  const lowerSource = normalizedSource.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerSource.indexOf(lowerQuery)
  if (matchIndex < 0) {
    return normalizedSource.length > 80 ? `${normalizedSource.slice(0, 80)}...` : normalizedSource
  }

  const start = Math.max(0, matchIndex - 24)
  const end = Math.min(normalizedSource.length, matchIndex + query.length + 32)
  const snippet = normalizedSource.slice(start, end).trim()
  const prefix = start > 0 ? '...' : ''
  const suffix = end < normalizedSource.length ? '...' : ''
  return `${prefix}${snippet}${suffix}`
}

export function searchNodes(project: Project, rawQuery: string): SearchResult[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const results: SearchResult[] = []

  for (const node of project.nodes) {
    const fields: Array<{ key: SearchResult['matchedField']; value: string }> = [
      { key: 'question', value: node.data.question },
      { key: 'answer', value: node.data.answer },
      { key: 'summary', value: node.data.summary },
    ]

    for (const field of fields) {
      if (!field.value.trim()) continue
      if (!field.value.toLowerCase().includes(query)) continue

      results.push({
        nodeId: node.id,
        matchedField: field.key,
        preview: buildPreview(field.value, rawQuery.trim()),
      })
      break
    }
  }

  return results
}

export function searchWikiPages(
  pages: WikiPage[],
  projectLookup: Map<string, string>,
  rawQuery: string,
): WikiSearchResult[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query || !pages) return []

  const results: WikiSearchResult[] = []

  for (const page of pages) {
    const matches: WikiSearchResult['matches'] = []

    if (page.title && page.title.toLowerCase().includes(query)) {
      matches.push({ field: 'title', preview: buildPreview(page.title, rawQuery.trim()) })
    }

    if (page.summary && page.summary.toLowerCase().includes(query)) {
      matches.push({ field: 'summary', preview: buildPreview(page.summary, rawQuery.trim()) })
    }

    if (page.content && page.content.toLowerCase().includes(query)) {
      matches.push({ field: 'content', preview: buildPreview(page.content, rawQuery.trim()) })
    }

    const matchedTags = page.tags.filter((tag) => tag.toLowerCase().includes(query))
    if (matchedTags.length > 0) {
      matches.push({ field: 'tags', preview: matchedTags.join(', ') })
    }

    const matchedTopics = page.relatedTopics.filter((topic) => topic.toLowerCase().includes(query))
    if (matchedTopics.length > 0) {
      matches.push({ field: 'relatedTopics', preview: matchedTopics.join(', ') })
    }

    if (matches.length > 0) {
      results.push({
        pageId: page.id,
        pageTitle: page.title || 'Untitled',
        projectId: page.sourceProjectId,
        projectTitle: page.sourceProjectId ? (projectLookup.get(page.sourceProjectId) ?? null) : null,
        matches,
      })
    }
  }

  return results
}
