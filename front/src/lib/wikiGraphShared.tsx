import {
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  Handle,
  Position,
} from '@xyflow/react'
import { BookOpen, GitBranch } from 'lucide-react'

import { LINK_TYPE_COLORS, LINK_TYPE_LABELS } from './insightUtils'
import type { WikiPage, WikiLink } from '../types'

export const PAGE_KIND_COLORS: Record<string, string> = {
  entity: '#6366f1',
  concept: '#22c55e',
  source_summary: '#f59e0b',
  comparison: '#a855f7',
  question: '#ef4444',
  index: '#06b6d4',
  log: '#78716c',
}

const ADMIN_CANONICAL_TITLES = new Set(['wiki-index', 'wiki-log'])

export function getPageKindFromTags(tags: string[]): string {
  const known = new Set(['entity', 'concept', 'source_summary', 'comparison', 'question', 'index', 'log'])
  for (const tag of tags) {
    if (known.has(tag)) return tag
  }
  return 'page'
}

export function WikiPageNode({ data }: { data: { label: string; canonicalTitle: string | null; tags: string[]; pageKind: string; sourceProjectId: string | null; sourceNodeId: string | null; onClick: () => void } }) {
  const kindColor = PAGE_KIND_COLORS[data.pageKind] || '#78716c'
  return (
    <div
      className="min-w-[180px] max-w-[260px] cursor-pointer rounded-[16px] border-2 bg-white/65 px-4 py-3 shadow-[0_4px_16px_rgba(23,23,28,0.06)] transition-shadow hover:shadow-[0_8px_24px_rgba(23,23,28,0.1)] backdrop-blur-xl"
      style={{ borderColor: kindColor }}
      onClick={data.onClick}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-olive-accent !border-2 !border-white" />
      <div className="flex items-start gap-2">
        <BookOpen size={14} className="mt-0.5 shrink-0" style={{ color: kindColor }} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-cohere-black">{data.label}</div>
          {data.canonicalTitle && !ADMIN_CANONICAL_TITLES.has(data.canonicalTitle) && (
            <div className="truncate text-[10px] text-muted-slate mt-0.5">{data.canonicalTitle}</div>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: kindColor }}
            >
              {data.pageKind}
            </span>
            {data.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="rounded-full bg-white/40 px-2 py-0.5 text-[10px] text-muted-slate">
                {tag}
              </span>
            ))}
          </div>
          {data.sourceProjectId && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-slate">
              <GitBranch size={10} />
              <span>project</span>
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-olive-accent !border-2 !border-white" />
    </div>
  )
}

export const wikiGraphNodeTypes = { wikiPage: WikiPageNode }

export function buildWikiGraphNodes(
  pages: WikiPage[],
  selectedPageId: string | null,
  onSelectPage: (id: string) => void,
): RFNode[] {
  const centerX = 400
  const centerY = 300
  const radius = 250

  return pages.map((page, index) => {
    const angle = (2 * Math.PI * index) / pages.length - Math.PI / 2
    const x = pages.length === 1 ? centerX : centerX + radius * Math.cos(angle)
    const y = pages.length === 1 ? centerY : centerY + radius * Math.sin(angle)

    return {
      id: page.id,
      type: 'wikiPage',
      position: { x, y },
      data: {
        label: page.title,
        canonicalTitle: page.canonicalTitle,
        tags: page.tags,
        pageKind: getPageKindFromTags(page.tags),
        sourceProjectId: page.sourceProjectId,
        sourceNodeId: page.sourceNodeId,
        onClick: () => onSelectPage(page.id),
      },
      selected: page.id === selectedPageId,
    }
  })
}

export function buildWikiGraphEdges(links: WikiLink[]): RFEdge[] {
  return links.map((link) => ({
    id: link.id,
    source: link.sourcePageId,
    target: link.targetPageId,
    animated: link.linkType === 'extension',
    style: {
      stroke: LINK_TYPE_COLORS[link.linkType] || LINK_TYPE_COLORS.reference,
      strokeWidth: 2,
    },
    label: LINK_TYPE_LABELS[link.linkType] || link.linkType,
    labelStyle: { fontSize: 10, fill: '#6b7280' },
    labelBgStyle: { fill: '#f7f7f8', fillOpacity: 0.9 },
    labelBgPadding: [4, 6] as [number, number],
    labelBgBorderRadius: 6,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: LINK_TYPE_COLORS[link.linkType] || LINK_TYPE_COLORS.reference,
    },
  }))
}
