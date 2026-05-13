import type { Edge, Node } from '@xyflow/react'

export interface ExplorationData {
  deep: string[]
  lateral: string[]
  applied: string[]
}

export interface KnoPathNodeData extends Record<string, unknown> {
  parentId: string | null
  type: 'root' | 'branch'
  question: string
  answer: string
  summary: string
  context: string
  isMarked: boolean
  isBranchCollapsed: boolean
  isNodeCollapsed: boolean
  createdAt: string
  updatedAt: string
  model?: string
  insightUpdatedAt?: string
  childrenCount: number
  turnCount?: number
  isFocused?: boolean
  nodeDepth?: number
  hasActiveFocus?: boolean
  exploration?: ExplorationData
}

export type KnoPathNode = Node<KnoPathNodeData, 'knopath'>
export type KnoPathEdge = Edge

export interface Project {
  id: string
  title: string
  nodes: KnoPathNode[]
  edges: KnoPathEdge[]
  createdAt: string
  updatedAt: string
  nodeCount: number
  isFavorite?: boolean
}

export interface ProjectSummary {
  id: string
  title: string
  updatedAt: string
  nodeCount: number
  isFavorite: boolean
}

export interface MarkedNode {
  id: string
  nodeId: string
  projectId: string
  content: string
  tags: string[]
  createdAt: string
}

export interface ModelProviderConfig {
  provider: 'openai-compatible'
  model: string
  apiKey: string
  baseUrl: string
  temperature: number
  systemPrompt: string
}

export interface KnowledgeBaseConfig {
  directoryName: string
  directoryPath: string
  autoInit: boolean
  lastValidated?: string
  directoryHandle?: FileSystemDirectoryHandle | null
  templates: {
    readme: string
    claude: string
    index: string
  }
}

export interface AppSettings {
  model: ModelProviderConfig
  knowledgeBase: KnowledgeBaseConfig
  explorationMode?: 'direct' | 'prompt'
  theme?: 'light' | 'dark'
  locale?: 'zh' | 'en'
}

export interface SearchResult {
  nodeId: string
  matchedField: 'question' | 'summary' | 'answer'
  preview: string
}

export interface WikiSearchResult {
  pageId: string
  pageTitle: string
  projectId: string | null
  projectTitle: string | null
  matches: Array<{
    field: 'title' | 'content' | 'summary' | 'tags' | 'relatedTopics'
    preview: string
  }>
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error'
export type WorkspaceMode = 'explore' | 'insight'

export type ExportFormat = 'markdown' | 'png' | 'knopath' | 'xmind'

export type SummaryMode = 'outline' | 'compare' | 'flashcard'
export type EditableInsightField = 'summary' | 'answer' | 'question'

export interface WikiPage {
  id: string
  title: string
  canonicalTitle: string | null
  content: string | null
  status: string
  sensitivity: string
  summary: string | null
  sourceReferences: string[]
  relatedTopics: string[]
  questions: string[]
  sourceNodeId: string | null
  sourceNodeIds: string[]
  sourceProjectId: string | null
  tags: string[]
  compiledAt: string | null
  updatedAt: string | null
}

export interface WikiLink {
  id: string
  sourcePageId: string
  targetPageId: string
  linkType: 'reference' | 'contradiction' | 'extension' | 'prerequisite'
  context: string | null
}

export interface WikiGraphData {
  pages: WikiPage[]
  links: WikiLink[]
}

export type ExplorationDirection = 'deep' | 'lateral' | 'applied'

export interface ExplorationOverlay {
  nodeId: string
  direction: ExplorationDirection
  options: string[]
}

export interface NodeContextMenu {
  nodeId: string
  x: number
  y: number
}

export interface AppState {
  currentProject: Project | null
  projects: Project[]
  focusedNodeId: string | null
  layoutAnimating: boolean
  layoutRevision: number
  markedNodes: MarkedNode[]
  settings: AppSettings
  syncStatus: SyncStatus
  leftPanelOpen: boolean
  insightLeftPanelOpen: boolean
  insightTemplatesOpen: boolean
  insightOutlineOpen: boolean
  insightLinksOpen: boolean
  insightSearchQuery: string
  exploreSearchQuery: string
  searchHighlight: { query: string; matchedField: string } | null
  rightPanelOpen: boolean
  bottomPanelOpen: boolean
  parentPanelOpen: boolean
  settingsOpen: boolean
  summaryMode: SummaryMode
  notice: string | null
  currentWorkspace: WorkspaceMode
  wikiGraph: WikiGraphData
  wikiCompiling: boolean
  selectedWikiPageId: string | null
  insightGraphOpen: boolean
  insightSyncing: boolean
  insightSyncProgress: string | null
  explorationOverlay: ExplorationOverlay | null
  nodeContextMenu: NodeContextMenu | null
}
