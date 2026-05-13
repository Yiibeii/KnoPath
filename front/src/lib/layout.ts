import type { KnoPathNode, Project } from '../types'
import { getChildNodes, getRootNodes } from './tree.js'

const HORIZONTAL_GAP = 320
const LEAF_VERTICAL_MARGIN = 84
const ROOT_VERTICAL_MARGIN = 120
const ROOT_START_X = 96
const ROOT_START_Y = 120

interface PositionedNode {
  id: string
  x: number
  y: number
}

function normalizeEdgeType(type: string | undefined): string {
  if (!type || type === 'bezier') return 'default'
  return type
}

function estimateNodeHeight(node: KnoPathNode): number {
  if (node.data.isNodeCollapsed) return 176
  return 380
}

function measureSubtree(
  node: KnoPathNode,
  project: Project,
  heights: Map<string, number>,
): number {
  const children = getChildNodes(node.id, project)
  const ownHeight = estimateNodeHeight(node)

  if (children.length === 0) {
    heights.set(node.id, ownHeight)
    return ownHeight
  }

  const childrenHeight =
    children.reduce((total, child) => total + measureSubtree(child, project, heights), 0) +
    LEAF_VERTICAL_MARGIN * (children.length - 1)
  const subtreeHeight = Math.max(ownHeight, childrenHeight)

  heights.set(node.id, subtreeHeight)
  return subtreeHeight
}

function layoutSubtree(
  node: KnoPathNode,
  project: Project,
  depth: number,
  topY: number,
  heights: Map<string, number>,
  positions: PositionedNode[],
): void {
  const children = getChildNodes(node.id, project)
  const ownHeight = estimateNodeHeight(node)
  const subtreeHeight = heights.get(node.id) ?? ownHeight

  positions.push({
    id: node.id,
    x: ROOT_START_X + depth * HORIZONTAL_GAP,
    y: topY + (subtreeHeight - ownHeight) / 2,
  })

  if (children.length === 0) {
    return
  }

  const childrenHeight =
    children.reduce((total, child) => total + (heights.get(child.id) ?? estimateNodeHeight(child)), 0) +
    LEAF_VERTICAL_MARGIN * (children.length - 1)
  let childTopY = topY + (subtreeHeight - childrenHeight) / 2

  for (const child of children) {
    layoutSubtree(child, project, depth + 1, childTopY, heights, positions)
    childTopY += (heights.get(child.id) ?? estimateNodeHeight(child)) + LEAF_VERTICAL_MARGIN
  }
}

export function autoLayoutProject(project: Project): Project {
  const roots = getRootNodes(project)
  if (roots.length === 0) return project

  const heights = new Map<string, number>()
  for (const root of roots) {
    measureSubtree(root, project, heights)
  }

  const positions: PositionedNode[] = []
  let nextRootTopY = ROOT_START_Y

  for (const root of roots) {
    layoutSubtree(root, project, 0, nextRootTopY, heights, positions)
    nextRootTopY += (heights.get(root.id) ?? estimateNodeHeight(root)) + ROOT_VERTICAL_MARGIN
  }

  const lookup = new Map(positions.map((item) => [item.id, item]))

  return {
    ...project,
    nodes: project.nodes.map((node) => {
      const nextPosition = lookup.get(node.id)
      if (!nextPosition) return node
      return {
        ...node,
        position: {
          x: nextPosition.x,
          y: nextPosition.y,
        },
      }
    }),
    edges: project.edges.map((edge) => ({
      ...edge,
      type: normalizeEdgeType(edge.type),
    })),
    updatedAt: new Date().toISOString(),
  }
}
