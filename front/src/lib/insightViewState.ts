export type InsightMainPanelMode = 'templates' | 'graph' | 'entry'

export function resolveInsightMainPanelMode({
  templatesOpen,
  graphOpen,
}: {
  templatesOpen: boolean
  graphOpen: boolean
}): InsightMainPanelMode {
  if (templatesOpen) return 'templates'
  if (graphOpen) return 'graph'
  return 'entry'
}
