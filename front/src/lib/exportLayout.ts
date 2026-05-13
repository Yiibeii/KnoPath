import type { KnoPathNode, Project } from '../types'
import { getChildNodes, getRootNodes } from './tree.js'

export interface ShareExportNodeLayout {
  node: KnoPathNode
  x: number
  y: number
  width: number
  height: number
  depth: number
}

export interface ShareExportLayout {
  nodes: ShareExportNodeLayout[]
  width: number
  height: number
}

const ROOT_CARD_WIDTH = 420
const BRANCH_CARD_WIDTH = 360
const ROOT_CARD_HEIGHT = 216
const BRANCH_CARD_HEIGHT = 188
const COLUMN_GAP = 132
const SIBLING_GAP = 54
const ROOT_GAP = 84

function isVisibleInExport(node: KnoPathNode, project: Project): boolean {
  let parentId = node.data.parentId

  while (parentId) {
    const parent = project.nodes.find((candidate) => candidate.id === parentId)
    if (!parent) return true
    if (parent.data.isBranchCollapsed) return false
    parentId = parent.data.parentId
  }

  return true
}

function sortByProjectOrder(nodes: KnoPathNode[], project: Project): KnoPathNode[] {
  const orderMap = new Map(project.nodes.map((node, index) => [node.id, index]))
  return [...nodes].sort((left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0))
}

function getCardWidth(node: KnoPathNode): number {
  return node.data.type === 'root' ? ROOT_CARD_WIDTH : BRANCH_CARD_WIDTH
}

function getCardHeight(node: KnoPathNode): number {
  return node.data.type === 'root' ? ROOT_CARD_HEIGHT : BRANCH_CARD_HEIGHT
}

export function buildShareExportLayout(project: Project): ShareExportLayout {
  const visibleNodes = project.nodes.filter((node) => isVisibleInExport(node, project))
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const visibleProject: Project = {
    ...project,
    nodes: visibleNodes,
    edges: project.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
  }

  const subtreeHeightCache = new Map<string, number>()

  const getVisibleChildren = (nodeId: string): KnoPathNode[] => {
    return sortByProjectOrder(getChildNodes(nodeId, visibleProject), visibleProject)
  }

  const measureSubtree = (node: KnoPathNode): number => {
    const cached = subtreeHeightCache.get(node.id)
    if (cached !== undefined) return cached

    const children = getVisibleChildren(node.id)
    const ownHeight = getCardHeight(node)

    if (children.length === 0) {
      subtreeHeightCache.set(node.id, ownHeight)
      return ownHeight
    }

    const childrenHeight = children.reduce((sum, child) => sum + measureSubtree(child), 0) + SIBLING_GAP * (children.length - 1)
    const subtreeHeight = Math.max(ownHeight, childrenHeight)
    subtreeHeightCache.set(node.id, subtreeHeight)
    return subtreeHeight
  }

  const positionedNodes: ShareExportNodeLayout[] = []
  let maxX = 0
  let maxY = 0

  const placeNode = (node: KnoPathNode, depth: number, top: number): void => {
    const width = getCardWidth(node)
    const height = getCardHeight(node)
    const subtreeHeight = measureSubtree(node)
    const x = depth * (ROOT_CARD_WIDTH + COLUMN_GAP)
    const y = top + (subtreeHeight - height) / 2

    positionedNodes.push({ node, x, y, width, height, depth })
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)

    const children = getVisibleChildren(node.id)
    if (children.length === 0) return

    const childrenTotalHeight =
      children.reduce((sum, child) => sum + measureSubtree(child), 0) + SIBLING_GAP * (children.length - 1)
    let childTop = top + (subtreeHeight - childrenTotalHeight) / 2

    for (const child of children) {
      placeNode(child, depth + 1, childTop)
      childTop += measureSubtree(child) + SIBLING_GAP
    }
  }

  const roots = sortByProjectOrder(getRootNodes(visibleProject), visibleProject)
  let rootTop = 0

  for (const root of roots) {
    placeNode(root, 0, rootTop)
    rootTop += measureSubtree(root) + ROOT_GAP
  }

  return {
    nodes: positionedNodes,
    width: maxX,
    height: maxY,
  }
}
