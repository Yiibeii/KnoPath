export interface InsightOutlineItem {
  id: string
  title: string
  level: number
}

export function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function buildInsightOutline(title: string, content: string): InsightOutlineItem[] {
  const safeTitle = title.trim() || 'Untitled insight'
  const items: InsightOutlineItem[] = [{ id: `${slugifyHeading(safeTitle) || 'untitled'}-root`, title: safeTitle, level: 1 }]
  const counts = new Map<string, number>()
  const normalized = content.replace(/\r\n/g, '\n')

  for (const line of normalized.split('\n')) {
    const match = line.trim().match(/^(#{1,6})\s+(.*)$/)
    if (!match) continue

    const rawTitle = match[2].trim()
    if (!rawTitle) continue

    const baseSlug = slugifyHeading(rawTitle) || 'section'
    const nextCount = (counts.get(baseSlug) ?? 0) + 1
    counts.set(baseSlug, nextCount)

    items.push({
      id: nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`,
      title: rawTitle,
      level: match[1].length,
    })
  }

  return items
}
