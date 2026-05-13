import type { KnoPathNode } from '../types'

export interface ViewportCenter {
  x: number
  y: number
}

export function getNodeViewportCenter(node: KnoPathNode): ViewportCenter {
  const width = node.width ?? 290
  const height = node.height ?? (node.data.isNodeCollapsed ? 176 : 380)

  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}
