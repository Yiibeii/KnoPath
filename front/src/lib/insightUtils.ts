import type { KnoPathNode, Project } from '../types'

export interface InsightEntry {
  project: Project
  node: KnoPathNode
}

export const LINK_TYPE_COLORS: Record<string, string> = {
  reference: '#6366f1',
  contradiction: '#ef4444',
  extension: '#22c55e',
  prerequisite: '#f59e0b',
}

export const LINK_TYPE_LABELS: Record<string, string> = {
  reference: 'Reference',
  contradiction: 'Contradiction',
  extension: 'Extension',
  prerequisite: 'Prerequisite',
}

export function formatTime(value?: string): string {
  if (!value) return 'Not compiled yet'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function buildBranchPath(node: KnoPathNode, nodes: KnoPathNode[]): string {
  const path: string[] = []
  let current: KnoPathNode | undefined = node

  while (current) {
    path.unshift(current.data.question || 'Untitled node')
    current = current.data.parentId ? nodes.find((item) => item.id === current?.data.parentId) : undefined
  }

  return path.join(' / ')
}

export function buildRawPreview(node: KnoPathNode, branchPath: string, projectTitle: string): string {
  return `---
project: ${projectTitle}
node_id: ${node.id}
compiled_at: ${node.data.insightUpdatedAt || 'pending'}
branch_path: ${branchPath}
---

# ${node.data.question || 'Untitled node'}

${node.data.answer || node.data.summary || 'Pending answer.'}
`
}

export function sortInsightEntries(entries: InsightEntry[]): InsightEntry[] {
  return entries.sort((left, right) => {
    const rightTime = right.node.data.insightUpdatedAt
    const leftTime = left.node.data.insightUpdatedAt
    if (!rightTime && !leftTime) return 0
    if (!rightTime) return -1
    if (!leftTime) return 1
    return rightTime.localeCompare(leftTime)
  })
}

export function filterEntriesByProjects(entries: InsightEntry[], projectIds: Set<string>): InsightEntry[] {
  if (projectIds.size === 0) return entries
  return entries.filter((entry) => projectIds.has(entry.project.id))
}

export function filterEntriesBySearch(entries: InsightEntry[], query: string): InsightEntry[] {
  if (!query.trim()) return entries
  const lowerQuery = query.toLowerCase()
  return entries.filter((entry) => {
    const summary = (entry.node.data.summary || '').toLowerCase()
    const question = (entry.node.data.question || '').toLowerCase()
    const projectTitle = entry.project.title.toLowerCase()
    return summary.includes(lowerQuery) || question.includes(lowerQuery) || projectTitle.includes(lowerQuery)
  })
}
