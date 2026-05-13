import type { InsightOutlineItem } from './insightOutline'

export function buildTemplateOutline(): InsightOutlineItem[] {
  return [
    { id: 'readme', title: 'README.md', level: 1 },
    { id: 'claude', title: 'CLAUDE.md', level: 1 },
    { id: 'index', title: 'index.md', level: 1 },
  ]
}

export function canToggleInsightLinks(templatesOpen: boolean, graphOpen: boolean = false): boolean {
  return !templatesOpen && !graphOpen
}

export function canToggleInsightOutline(templatesOpen: boolean, graphOpen: boolean = false): boolean {
  return !templatesOpen && !graphOpen
}
