import type { MarkedNode, Project } from '../types'
import { getChildNodes, getRootNodes } from './tree.js'

function buildTreeMarkdown(nodeId: string, project: Project, depth = 2): string[] {
  const node = project.nodes.find((item) => item.id === nodeId)
  if (!node) return []

  const heading = `${'#'.repeat(depth)} ${node.data.question || 'Untitled node'}`
  const answer = node.data.answer.trim() || '_No answer yet._'
  const summary = node.data.summary.trim()

  const lines = [heading, '', answer, '']
  if (summary) {
    lines.push(`Summary: ${summary}`, '')
  }

  for (const child of getChildNodes(nodeId, project)) {
    lines.push(...buildTreeMarkdown(child.id, project, depth + 1))
  }

  return lines
}

export function generateMarkdown(project: Project, markedNodes: MarkedNode[]): string {
  const markedSection = markedNodes
    .map((marked) => project.nodes.find((node) => node.id === marked.nodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map((node) => `- ${node.data.summary.trim() || node.data.answer.trim() || node.data.question.trim()}`)

  const explorationTree = getRootNodes(project).flatMap((node) => buildTreeMarkdown(node.id, project))

  return [
    `# ${project.title}`,
    '',
    '## Key conclusions',
    markedSection.length > 0 ? markedSection.join('\n') : '- No marked conclusions yet.',
    '',
    '## Exploration tree',
    ...explorationTree,
  ]
    .join('\n')
    .trim()
}

export function downloadMarkdown(project: Project, markedNodes: MarkedNode[]): void {
  const markdown = generateMarkdown(project, markedNodes)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${project.title}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}
