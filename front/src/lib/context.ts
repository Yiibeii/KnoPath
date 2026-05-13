import type { Project } from '../types'
import { getAncestorChain } from './tree.js'

export function buildContext(nodeId: string, project: Project): string {
  const chain = getAncestorChain(nodeId, project)
  const currentNode = chain[chain.length - 1]
  const ancestorSummaries = chain
    .slice(0, -1)
    .map((node) => node.data.summary.trim())
    .filter(Boolean)
  const markedConclusions = chain
    .filter((node) => node.data.isMarked)
    .map((node) => node.data.summary.trim() || node.data.answer.trim())
    .filter(Boolean)

  return [
    'Ancestor summaries:',
    ancestorSummaries.length > 0 ? ancestorSummaries.map((line) => `- ${line}`).join('\n') : '- None yet',
    '',
    'Marked conclusions:',
    markedConclusions.length > 0 ? markedConclusions.map((line) => `- ${line}`).join('\n') : '- None yet',
    '',
    'Current question:',
    currentNode?.data.question?.trim() || '',
  ]
    .join('\n')
    .trim()
}
