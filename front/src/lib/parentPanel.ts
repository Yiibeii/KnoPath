export interface ParentPanelMeta {
  title: string
  levelLabel: string
  secondaryLabel: string
}

export function getParentPanelMeta(nodeDepth: number): ParentPanelMeta {
  return {
    title: 'Parent Node',
    levelLabel: nodeDepth <= 1 ? 'Root' : `L${nodeDepth - 1}`,
    secondaryLabel: 'Direct parent',
  }
}
