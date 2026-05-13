import type { Project, KnoPathNode } from '../types'

export type KeyboardNavigationDirection = 'w' | 'a' | 's' | 'd'

export function getNodeById(nodeId: string, project: Project): KnoPathNode | undefined {
  return project.nodes.find((node) => node.id === nodeId)
}

export function getChildNodes(nodeId: string, project: Project): KnoPathNode[] {
  const childIds = project.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target)
  return project.nodes.filter((node) => childIds.includes(node.id))
}

export function getNodeDepth(nodeId: string, project: Project): number {
  let depth = 0
  let current = getNodeById(nodeId, project)

  while (current?.data.parentId) {
    depth += 1
    current = getNodeById(current.data.parentId, project)
  }

  return depth
}

export function canCreateChildNode(parentId: string, project: Project): boolean {
  void parentId
  void project
  return true
}

export function getRootNodes(project: Project): KnoPathNode[] {
  const childIds = new Set(project.edges.map((edge) => edge.target))
  return project.nodes.filter((node) => !childIds.has(node.id))
}

export function getAncestorChain(nodeId: string, project: Project): KnoPathNode[] {
  const chain: KnoPathNode[] = []
  let current = getNodeById(nodeId, project)

  while (current) {
    chain.unshift(current)
    current = current.data.parentId ? getNodeById(current.data.parentId, project) : undefined
  }

  return chain
}

function sortNodesByVerticalPosition(nodes: KnoPathNode[]): KnoPathNode[] {
  return [...nodes].sort((left, right) => {
    if (left.position.y !== right.position.y) {
      return left.position.y - right.position.y
    }

    return left.position.x - right.position.x
  })
}

export function getKeyboardNavigationTarget(
  project: Project,
  nodeId: string,
  direction: KeyboardNavigationDirection,
): string | null {
  const currentNode = getNodeById(nodeId, project)
  if (!currentNode) return null

  if (direction === 'a') {
    return currentNode.data.parentId
  }

  if (direction === 'd') {
    const children = getChildNodes(nodeId, project)
    if (children.length === 0) return null

    return [...children]
      .sort((left, right) => {
        const leftDistance = Math.abs(left.position.y - currentNode.position.y)
        const rightDistance = Math.abs(right.position.y - currentNode.position.y)
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance
        }

        return left.position.y - right.position.y
      })[0]?.id ?? null
  }

  const siblings = sortNodesByVerticalPosition(
    project.nodes.filter((node) => node.id !== nodeId && node.data.parentId === currentNode.data.parentId),
  )

  if (siblings.length === 0) return null

  if (direction === 'w') {
    const upperSiblings = siblings.filter((node) => node.position.y < currentNode.position.y)
    const upperSibling = upperSiblings[upperSiblings.length - 1]

    return upperSibling?.id ?? null
  }

  const lowerSibling = siblings.find((node) => node.position.y > currentNode.position.y)
  return lowerSibling?.id ?? null
}

export function updateChildrenCounts(project: Project): Project {
  const childCountMap = new Map<string, number>()

  for (const edge of project.edges) {
    childCountMap.set(edge.source, (childCountMap.get(edge.source) ?? 0) + 1)
  }

  return {
    ...project,
    nodes: project.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        childrenCount: childCountMap.get(node.id) ?? 0,
      },
    })),
  }
}
