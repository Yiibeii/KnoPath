import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

import type {
  AppSettings,
  AppState,
  ExplorationData,
  ExplorationOverlay,
  NodeContextMenu,
  KnoPathNode,
  KnoPathEdge,
  MarkedNode,
  Project,
  SummaryMode,
  SyncStatus,
  WorkspaceMode,
} from '../types'
import {
  loadSettings,
  saveSettings,
} from '../db'
import { buildContext } from '../lib/context'
import { autoLayoutProject } from '../lib/layout'
import { generateAnswer } from '../lib/llm'
import { getAncestorChain, getChildNodes, updateChildrenCounts } from '../lib/tree'
import {
  saveProjectToBackend,
  deleteProjectFromBackend,
  getWikiGraph,
  streamSyncWikiPages,
  compileWiki as compileWikiApi,
  deleteWikiPage as deleteWikiPageApi,
  deleteWikiPageLocal as deleteWikiPageLocalApi,
  updateProject as updateProjectApi,
  getProjects as getProjectsApi,
  getProject as getProjectApi,
  createProject as createProjectApi,
  getRepositorySettings as getRepositorySettingsApi,
  updateRepositorySettings as updateRepositorySettingsApi,
  importProjectsFromFiles,
  importWikiPagesFromFiles,
  updateGlobalSettings as updateGlobalSettingsApi,
  getGlobalSettings as getGlobalSettingsApi,
} from '../lib/api'
import { isElectron, pathExistsElectron } from '../lib/electronFS'

let _insightSyncAbortController: AbortController | null = null

function toIsoString(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString()
  return value instanceof Date ? value.toISOString() : value
}

function normalizeNode(node: KnoPathNode): KnoPathNode {
  const isBranchCollapsed = Boolean(node.data.isBranchCollapsed)
  const isNodeCollapsed = Boolean(node.data.isNodeCollapsed)

  return {
    ...node,
    type: 'knopath',
    width: node.width ?? 290,
    height: node.height ?? (isNodeCollapsed ? 176 : 380),
    data: {
      parentId: (node.data.parentId as string | null | undefined) ?? null,
      type: node.data.type === 'branch' ? 'branch' : 'root',
      question: String(node.data.question ?? ''),
      answer: String(node.data.answer ?? ''),
      summary: String(node.data.summary ?? ''),
      context: String(node.data.context ?? ''),
      isMarked: Boolean(node.data.isMarked),
      isBranchCollapsed,
      isNodeCollapsed,
      createdAt: toIsoString(node.data.createdAt as string | Date | undefined),
      updatedAt: toIsoString(node.data.updatedAt as string | Date | undefined),
      model: node.data.model ? String(node.data.model) : undefined,
      insightUpdatedAt: node.data.insightUpdatedAt ? toIsoString(node.data.insightUpdatedAt as string | Date) : undefined,
      childrenCount: Number(node.data.childrenCount ?? 0),
      turnCount: Number(node.data.turnCount ?? 0),
      exploration: node.data.exploration as ExplorationData | undefined,
    },
  }
}

function normalizeEdgeType(type: string | undefined): string {
  if (!type || type === 'bezier') return 'default'
  return type
}

function normalizeProject(project: Project): Project {
  return updateChildrenCounts({
    ...project,
    createdAt: toIsoString(project.createdAt),
    updatedAt: toIsoString(project.updatedAt),
    nodes: project.nodes.map(normalizeNode),
    edges: project.edges.map((edge) => ({
      ...edge,
      type: normalizeEdgeType(edge.type),
    })),
    nodeCount: project.nodes.length,
  })
}

function deriveMarkedNodes(project: Project | null): MarkedNode[] {
  if (!project) return []

  return project.nodes
    .filter((node) => node.data.isMarked)
    .map((node) => ({
      id: `${project.id}:${node.id}`,
      nodeId: node.id,
      projectId: project.id,
      content: node.data.summary || node.data.answer || node.data.question,
      tags: [],
      createdAt: toIsoString(node.data.updatedAt || node.data.createdAt),
    }))
}

function generateNodeId(question: string): string {
  const now = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  const safeTitle = question.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').slice(0, 30)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${timestamp}-${safeTitle}-${suffix}`
}

function createDefaultNode(question: string, parentId: string | null): KnoPathNode {
  const now = new Date().toISOString()
  return {
    id: generateNodeId(question),
    type: 'knopath',
    position: { x: 96, y: 120 },
    width: 290,
    height: parentId ? 380 : 380,
    data: {
      parentId,
      type: parentId ? 'branch' : 'root',
      question,
      answer: '',
      summary: '',
      context: '',
      isMarked: false,
      isBranchCollapsed: false,
      isNodeCollapsed: false,
      createdAt: now,
      updatedAt: now,
      childrenCount: 0,
      turnCount: 0,
      insightUpdatedAt: undefined,
    },
  }
}

function createDefaultSettings(): AppSettings {
  return {
    model: {
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      temperature: 0.7,
      systemPrompt: '',
    },
    knowledgeBase: {
      directoryName: '',
      directoryPath: '',
      autoInit: true,
      lastValidated: undefined,
      directoryHandle: null,
      templates: {
        readme: '# KnoPath Knowledge Base\n\nThis directory was initialized by KnoPath Insight.\n',
        claude: '# KnoPath Insight Rules\n\nUse summaries as stable conclusions and preserve source references.\n',
        index: '# Knowledge Base Index\n\nUpdated: {{updatedAt}}\n\n## Wiki\n{{wikiLinks}}\n\nThis compile added or updated {{count}} Insight{{plural}}.\n',
      },
    },
    explorationMode: 'direct',
    theme: 'light',
    locale: 'zh',
  }
}

function migrateLegacySettings(settings: AppSettings | undefined): AppSettings {
  const defaults = createDefaultSettings()
  if (!settings) return defaults

  if ('knowledgeBase' in settings && settings.knowledgeBase) {
    return {
      model: {
        ...defaults.model,
        ...settings.model,
      },
      knowledgeBase: {
        ...defaults.knowledgeBase,
        ...settings.knowledgeBase,
        templates: {
          ...defaults.knowledgeBase.templates,
          ...(settings.knowledgeBase.templates ?? {}),
        },
      },
      explorationMode: settings.explorationMode ?? defaults.explorationMode,
      theme: settings.theme ?? defaults.theme,
      locale: settings.locale ?? defaults.locale,
    }
  }

  return {
    model: {
      ...defaults.model,
      ...settings.model,
    },
    knowledgeBase: defaults.knowledgeBase,
    explorationMode: settings.explorationMode ?? defaults.explorationMode,
    theme: settings.theme ?? defaults.theme,
    locale: settings.locale ?? defaults.locale,
  }
}

function createDefaultProject(): Project {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    title: `Untitled Explore ${new Date().toLocaleDateString('zh-CN')}`,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
    nodeCount: 0,
    isFavorite: false,
  }
}

function createUniqueProjectTitle(baseTitle: string, projects: Project[], currentProjectId: string): string {
  const existingTitles = new Set(
    projects
      .filter((project) => project.id !== currentProjectId)
      .map((project) => project.title),
  )
  let finalTitle = baseTitle
  let counter = 1
  while (existingTitles.has(finalTitle)) {
    finalTitle = `${baseTitle}(${counter})`
    counter++
  }
  return finalTitle
}

function collectDescendantIds(nodeId: string, project: Project): string[] {
  const descendants = new Set<string>([nodeId])
  const stack = [nodeId]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const child of getChildNodes(current, project)) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id)
        stack.push(child.id)
      }
    }
  }

  return [...descendants]
}

function positionNode(project: Project, node: KnoPathNode, parentId: string | null): KnoPathNode {
  if (!parentId) {
    const rootIndex = project.nodes.filter((item) => item.data.parentId === null).length
    return {
      ...node,
      position: {
        x: 80 + rootIndex * 60,
        y: 120 + rootIndex * 220,
      },
    }
  }

  const parent = project.nodes.find((item) => item.id === parentId)
  if (!parent) return node

  const siblings = project.edges.filter((edge) => edge.source === parentId).length
  return {
    ...node,
    position: {
      x: parent.position.x + 360,
      y: parent.position.y + siblings * 220,
    },
  }
}

interface StoreActions {
  createProject: () => Promise<void>
  loadProjects: () => Promise<void>
  loadSettings: () => Promise<void>
  validateAndLoadRepository: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  updateProjectTitle: (title: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  toggleProjectFavorite: (id: string) => Promise<void>
  createNode: (parentId: string | null, question: string) => Promise<string | null>
  generateNodeAnswer: (nodeId: string) => Promise<void>
  updateNodeQuestion: (nodeId: string, question: string) => Promise<void>
  setNodeAnswerDraft: (nodeId: string, answer: string, model?: string) => void
  updateNodeAnswer: (nodeId: string, answer: string, model?: string) => Promise<void>
  updateNodeSummary: (nodeId: string, summary: string) => Promise<void>
  updateNodeExploration: (nodeId: string, exploration: ExplorationData) => Promise<void>
  updateNodeContext: (nodeId: string, context: string) => Promise<void>
  updateNodesInsightTimestamp: (nodeIds: string[], compiledAt: string) => Promise<void>
  toggleNodeMarked: (nodeId: string) => Promise<void>
  toggleNodeBranchCollapsed: (nodeId: string) => Promise<void>
  toggleNodeCollapsed: (nodeId: string) => Promise<void>
  toggleAllNodesCollapsed: () => Promise<void>
  removeNode: (nodeId: string) => Promise<void>
  updateNodePosition: (nodeId: string, x: number, y: number) => Promise<void>
  autoLayoutCurrentProject: () => Promise<void>
  setFocusedNode: (nodeId: string | null) => void
  setLayoutAnimating: (animating: boolean) => void
  setSyncStatus: (status: SyncStatus) => void
  toggleLeftPanel: () => void
  toggleInsightLeftPanel: () => void
  toggleInsightTemplates: () => void
  setInsightTemplatesOpen: (open: boolean) => void
  toggleInsightOutline: () => void
  toggleInsightLinks: () => void
  setInsightSearchQuery: (query: string) => void
  setExploreSearchQuery: (query: string) => void
  setSearchHighlight: (highlight: { query: string; matchedField: string } | null) => void
  toggleRightPanel: () => void
  toggleBottomPanel: () => void
  toggleParentPanel: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSettings: (settings: AppSettings) => void
  updateSettings: (settings: AppSettings) => Promise<void>
  updateKnowledgeBaseTemplates: (templates: AppSettings['knowledgeBase']['templates']) => Promise<void>
  updateProjectNodeContent: (
    projectId: string,
    nodeId: string,
    updates: Partial<Pick<KnoPathNode['data'], 'summary' | 'answer' | 'question'>>,
  ) => Promise<void>
  setSummaryMode: (mode: SummaryMode) => void
  setNotice: (message: string | null) => void
  setWorkspace: (workspace: WorkspaceMode) => void
  saveCurrentProject: () => Promise<void>
  importFromRepository: () => Promise<number>
  setCurrentProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void
  loadWikiGraph: () => Promise<void>
  syncWikiPagesForProject: (projectId: string) => Promise<void>
  compileWikiForProject: (projectId: string) => Promise<void>
  deleteWikiPage: (pageId: string) => Promise<void>
  deleteWikiPageLocal: (pageId: string) => Promise<void>
  setSelectedWikiPageId: (pageId: string | null) => void
  toggleInsightGraph: () => void
  resetRepositoryPath: () => void
  streamSyncInsight: (projectId: string) => Promise<void>
  cancelInsightSync: () => void
  setExplorationOverlay: (overlay: ExplorationOverlay | null) => void
  setNodeContextMenu: (menu: NodeContextMenu | null) => void
}

export const useStore = create<AppState & StoreActions>((set, get) => ({
  currentProject: null,
  projects: [],
  focusedNodeId: null,
  layoutAnimating: false,
  layoutRevision: 0,
  markedNodes: [],
  settings: createDefaultSettings(),
  syncStatus: 'synced',
  leftPanelOpen: true,
  insightLeftPanelOpen: true,
  insightTemplatesOpen: false,
  insightOutlineOpen: false,
  insightLinksOpen: true,
  insightSearchQuery: '',
  exploreSearchQuery: '',
  searchHighlight: null as { query: string; matchedField: string } | null,
  rightPanelOpen: true,
  bottomPanelOpen: false,
  parentPanelOpen: false,
  settingsOpen: false,
  summaryMode: 'outline',
  notice: null,
  currentWorkspace: 'explore',
  wikiGraph: { pages: [], links: [] },
  wikiCompiling: false,
  selectedWikiPageId: null,
  insightGraphOpen: false,
  insightSyncing: false,
  insightSyncProgress: null,
  explorationOverlay: null,
  nodeContextMenu: null,

  createProject: async () => {
    const project = normalizeProject(await createProjectApi(createDefaultProject().title))
    set((state) => ({
      projects: [project, ...state.projects],
      currentProject: project,
      focusedNodeId: null,
      markedNodes: [],
      notice: 'Created a new project.',
    }))
  },

  loadProjects: async () => {
    const projects = (await getProjectsApi()).map(normalizeProject)
    const currentProjectId = get().currentProject?.id
    const currentProject = (currentProjectId ? projects.find((project) => project.id === currentProjectId) : null) ?? projects[0] ?? null

    set({
      projects,
      currentProject,
      markedNodes: deriveMarkedNodes(currentProject),
    })
  },

  loadSettings: async () => {
    const settings = migrateLegacySettings(await loadSettings())
    try {
      const repositorySettings = await getRepositorySettingsApi()
      if (repositorySettings.repositoryRoot) {
        settings.knowledgeBase.directoryPath = repositorySettings.repositoryRoot
        settings.knowledgeBase.directoryName = repositorySettings.repositoryRoot.split(/[/\\]/).pop() || repositorySettings.repositoryRoot
      } else {
        settings.knowledgeBase.directoryPath = ''
        settings.knowledgeBase.directoryName = ''
      }
    } catch {
      // Keep local settings when backend repository settings are unavailable.
    }
    try {
      const backendSettings = await getGlobalSettingsApi() as { knowledgeBase?: { templates?: { readme?: string; claude?: string; index?: string } } }
      const backendTemplates = backendSettings.knowledgeBase?.templates
      if (backendTemplates) {
        if (backendTemplates.readme) settings.knowledgeBase.templates.readme = backendTemplates.readme
        if (backendTemplates.claude) settings.knowledgeBase.templates.claude = backendTemplates.claude
        if (backendTemplates.index) settings.knowledgeBase.templates.index = backendTemplates.index
      }
    } catch {
      // Keep local templates when backend is unavailable.
    }
    await saveSettings(settings)
    set({ settings })
  },

  selectProject: async (id) => {
    const project = await getProjectApi(id)
    const normalizedProject = normalizeProject(project)
    
    // Check if project needs auto-layout (nodes have default positions)
    const needsLayout = normalizedProject.nodes.some(node => 
      node.position.x === 96 && node.position.y === 120
    )
    
    const finalProject = needsLayout ? autoLayoutProject(normalizedProject) : normalizedProject
    
    set({
      currentProject: finalProject,
      focusedNodeId: null,
      markedNodes: deriveMarkedNodes(finalProject),
      notice: `Opened "${finalProject.title}".`,
    })
    
    // Save layout if we applied auto-layout
    if (needsLayout && finalProject.nodes.length > 0) {
      await saveProjectToBackend(finalProject)
    }
  },

  updateProjectTitle: async (title) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const updatedProject = {
      ...currentProject,
      title,
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: updatedProject,
      projects: state.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    }))

    const syncedProject = normalizeProject(await updateProjectApi(currentProject.id, { title }))
    set((state) => ({
      currentProject: state.currentProject?.id === syncedProject.id ? syncedProject : state.currentProject,
      projects: state.projects.map((project) => (project.id === syncedProject.id ? syncedProject : project)),
      markedNodes: state.currentProject?.id === syncedProject.id ? deriveMarkedNodes(syncedProject) : state.markedNodes,
    }))
  },

  removeProject: async (id) => {
    await deleteProjectFromBackend(id)
    set((state) => {
      const projects = state.projects.filter((project) => project.id !== id)
      const currentProject = state.currentProject?.id === id ? projects[0] ?? null : state.currentProject
      return {
        projects,
        currentProject,
        markedNodes: currentProject ? state.markedNodes : [],
        focusedNodeId: currentProject ? state.focusedNodeId : null,
        notice: 'Project removed.',
      }
    })
  },

  toggleProjectFavorite: async (id) => {
    const project = get().projects.find((item) => item.id === id)
    if (!project) return

    const nextProject = {
      ...project,
      isFavorite: !project.isFavorite,
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      projects: state.projects.map((item) => (item.id === id ? nextProject : item)),
      currentProject: state.currentProject?.id === id ? nextProject : state.currentProject,
      notice: nextProject.isFavorite ? 'Added to favorites.' : 'Removed from favorites.',
    }))

    const syncedProject = normalizeProject(await updateProjectApi(id, { isFavorite: nextProject.isFavorite }))
    set((state) => ({
      projects: state.projects.map((project) => (project.id === id ? syncedProject : project)),
      currentProject: state.currentProject?.id === id ? syncedProject : state.currentProject,
      markedNodes: state.currentProject?.id === id ? deriveMarkedNodes(syncedProject) : state.markedNodes,
    }))
  },

  createNode: async (parentId, question) => {
    const state = get()
    if (!state.currentProject) return null

    const trimmedQuestion = question.trim()

    const draftNode = createDefaultNode(trimmedQuestion, parentId)
    const positionedNode = positionNode(state.currentProject, draftNode, parentId)
    const expandedAncestorIds = new Set(
      parentId
        ? getAncestorChain(parentId, state.currentProject)
            .filter((node) => node.data.isBranchCollapsed)
            .map((node) => node.id)
        : [],
    )
    const nextEdges: KnoPathEdge[] = parentId
      ? [
          ...state.currentProject.edges,
          {
            id: `edge-${parentId}-${positionedNode.id}`,
            source: parentId,
            target: positionedNode.id,
            type: 'default',
          },
        ]
      : state.currentProject.edges

    let projectTitle = state.currentProject.title
    const isFirstRootNode = !parentId && state.currentProject.nodes.length === 0
    if (isFirstRootNode && trimmedQuestion) {
      projectTitle = createUniqueProjectTitle(trimmedQuestion, state.projects, state.currentProject.id)
    }

    const nextProject = autoLayoutProject(updateChildrenCounts({
      ...state.currentProject,
      title: projectTitle,
      nodes: [
        ...state.currentProject.nodes.map((node) =>
          expandedAncestorIds.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  isBranchCollapsed: false,
                  updatedAt: new Date().toISOString(),
                },
              }
            : node,
        ),
        positionedNode,
      ],
      edges: nextEdges,
      nodeCount: state.currentProject.nodes.length + 1,
      updatedAt: new Date().toISOString(),
    }))

    set((currentState) => ({
      currentProject: nextProject,
      projects: currentState.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
      focusedNodeId: positionedNode.id,
      layoutAnimating: true,
      layoutRevision: currentState.layoutRevision + 1,
      notice: parentId ? 'Created a new branch.' : 'Created a root question.',
    }))

    // Empty nodes are local drafts until the prompt is filled in the inspector.
    if (trimmedQuestion) {
      await saveProjectToBackend(nextProject)
    }
    
    window.setTimeout(() => {
      get().setLayoutAnimating(false)
    }, 380)
    return positionedNode.id
  },

  generateNodeAnswer: async (nodeId) => {
    const state = get()
    const currentProject = state.currentProject
    if (!currentProject) return

    const node = currentProject.nodes.find((n) => n.id === nodeId)
    if (!node) return

    const question = node.data.question.trim()
    if (!question) return

    const context = buildContext(nodeId, currentProject)
    await state.updateNodeContext(nodeId, context)

    let streamedAnswer = ''
    state.setNodeAnswerDraft(nodeId, '', state.settings.model.apiKey.trim() ? state.settings.model.model : 'local-mock')

    try {
      const generated = await generateAnswer(question, context, state.settings, {
        onDelta: (chunk) => {
          streamedAnswer += chunk
          const cleanAnswer = streamedAnswer
            .replace(/\[RESPONSE\]/gi, '')
            .replace(/\[SUMMARY\][\s\S]*$/gi, '')
            .trim()
          state.setNodeAnswerDraft(nodeId, cleanAnswer, state.settings.model.apiKey.trim() ? state.settings.model.model : 'local-mock')
        },
      })

      await state.updateNodeAnswer(nodeId, generated.answer, generated.model)
      await state.updateNodeSummary(nodeId, generated.summary || '')
      if (generated.exploration) {
        await state.updateNodeExploration(nodeId, generated.exploration)
      }
      state.setNotice(
        generated.source === 'live'
          ? `Node response generated with ${generated.model}.`
          : 'No API key set, so KnoPath used the local mock pipeline.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The model request failed, but your node was preserved.'
      state.setNotice(message)
    }
  },

  updateNodeQuestion: async (nodeId, question) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const trimmedQuestion = question.trim()
    const currentNode = currentProject.nodes.find((node) => node.id === nodeId)
    const shouldRenameProject =
      Boolean(trimmedQuestion) &&
      currentNode?.data.type === 'root' &&
      currentNode.data.parentId === null &&
      currentProject.nodes.length === 1

    const nextProject = {
      ...currentProject,
      title: shouldRenameProject
        ? createUniqueProjectTitle(trimmedQuestion, get().projects, currentProject.id)
        : currentProject.title,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                question,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  setNodeAnswerDraft: (nodeId, answer, model) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const timestamp = new Date().toISOString()
    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                answer,
                model,
                updatedAt: timestamp,
              },
            }
          : node,
      ),
      updatedAt: timestamp,
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
  },

  updateNodeAnswer: async (nodeId, answer, model) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                answer,
                model,
                turnCount: (node.data.turnCount ?? 0) + 1,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  updateNodeSummary: async (nodeId, summary) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                summary,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  updateNodeExploration: async (nodeId, exploration) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                exploration,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  updateNodeContext: async (nodeId, context) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                context,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  updateNodesInsightTimestamp: async (nodeIds, compiledAt) => {
    const currentProject = get().currentProject
    if (!currentProject || nodeIds.length === 0) return

    const nodeIdSet = new Set(nodeIds)
    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        nodeIdSet.has(node.id)
          ? {
              ...node,
              data: {
                ...node.data,
                insightUpdatedAt: compiledAt,
                updatedAt: compiledAt,
              },
            }
          : node,
      ),
      updatedAt: compiledAt,
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  toggleNodeMarked: async (nodeId) => {
    const state = get()
    if (!state.currentProject) return

    const node = state.currentProject.nodes.find((item) => item.id === nodeId)
    if (!node) return

    const nextMarked = !node.data.isMarked
    const updatedNode = {
      ...node,
      data: {
        ...node.data,
        isMarked: nextMarked,
        updatedAt: new Date().toISOString(),
      },
    }

    const nextProject = {
      ...state.currentProject,
      nodes: state.currentProject.nodes.map((item) => (item.id === nodeId ? updatedNode : item)),
      updatedAt: new Date().toISOString(),
    }

    set((currentState) => ({
      currentProject: nextProject,
      projects: currentState.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
      markedNodes: deriveMarkedNodes(nextProject),
      notice: nextMarked ? 'Marked as a key conclusion.' : 'Removed key conclusion mark.',
    }))

    await saveProjectToBackend(nextProject)
  },

  toggleNodeBranchCollapsed: async (nodeId) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                isBranchCollapsed: !node.data.isBranchCollapsed,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  toggleNodeCollapsed: async (nodeId) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              height: node.data.isNodeCollapsed ? 380 : 176,
              data: {
                ...node.data,
                isNodeCollapsed: !node.data.isNodeCollapsed,
                updatedAt: new Date().toISOString(),
              },
            }
          : node,
      ),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  toggleAllNodesCollapsed: async () => {
    const currentProject = get().currentProject
    if (!currentProject || currentProject.nodes.length === 0) return

    const allCollapsed = currentProject.nodes.every((node) => node.data.isNodeCollapsed)
    const nextCollapsed = !allCollapsed

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) => ({
        ...node,
        height: nextCollapsed ? 176 : 380,
        data: {
          ...node.data,
          isNodeCollapsed: nextCollapsed,
          updatedAt: new Date().toISOString(),
        },
      })),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
      notice: nextCollapsed ? 'All nodes collapsed.' : 'All nodes expanded.',
    }))
    await saveProjectToBackend(nextProject)
  },

  removeNode: async (nodeId) => {
    const state = get()
    if (!state.currentProject) return

    const idsToRemove = collectDescendantIds(nodeId, state.currentProject)

    const nodeToRemove = state.currentProject.nodes.find((n) => n.id === nodeId)
    const parentId = nodeToRemove?.data.parentId

    let nextFocusedNodeId: string | null = null
    if (idsToRemove.includes(state.focusedNodeId ?? '')) {
      if (parentId) {
        const siblings = state.currentProject.nodes.filter(
          (n) => n.data.parentId === parentId && !idsToRemove.includes(n.id)
        )
        if (siblings.length > 0) {
          nextFocusedNodeId = siblings[0].id
        } else {
          nextFocusedNodeId = parentId
        }
      }
    } else {
      nextFocusedNodeId = state.focusedNodeId
    }

    const nextProject = updateChildrenCounts({
      ...state.currentProject,
      nodes: state.currentProject.nodes.filter((node) => !idsToRemove.includes(node.id)),
      edges: state.currentProject.edges.filter(
        (edge) => !idsToRemove.includes(edge.source) && !idsToRemove.includes(edge.target),
      ),
      nodeCount: state.currentProject.nodes.length - idsToRemove.length,
      updatedAt: new Date().toISOString(),
    })

    set((currentState) => ({
      currentProject: nextProject,
      projects: currentState.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
      markedNodes: deriveMarkedNodes(nextProject),
      focusedNodeId: nextFocusedNodeId,
      notice: 'Removed the selected branch.',
    }))

    await saveProjectToBackend(nextProject)
  },

  updateNodePosition: async (nodeId, x, y) => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = {
      ...currentProject,
      nodes: currentProject.nodes.map((node) => (node.id === nodeId ? { ...node, position: { x, y } } : node)),
      updatedAt: new Date().toISOString(),
    }

    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }))
    await saveProjectToBackend(nextProject)
  },

  autoLayoutCurrentProject: async () => {
    const currentProject = get().currentProject
    if (!currentProject) return

    const nextProject = autoLayoutProject(currentProject)
    set((state) => ({
      currentProject: nextProject,
      projects: state.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
      layoutAnimating: true,
      layoutRevision: state.layoutRevision + 1,
      notice: 'Auto layout applied to the current knowledge tree.',
    }))
    await saveProjectToBackend(nextProject)
    window.setTimeout(() => {
      get().setLayoutAnimating(false)
    }, 380)
  },

  setFocusedNode: (nodeId) => {
    const currentProject = get().currentProject
    if (currentProject && nodeId) {
      const context = buildContext(nodeId, currentProject)
      set({ focusedNodeId: nodeId, notice: null })
      void get().updateNodeContext(nodeId, context)
      return
    }

    set({ focusedNodeId: nodeId, notice: null })
  },

  setLayoutAnimating: (animating) => set({ layoutAnimating: animating }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleInsightLeftPanel: () => set((state) => ({ insightLeftPanelOpen: !state.insightLeftPanelOpen })),
  toggleInsightTemplates: () => set((state) => {
    const nextOpen = !state.insightTemplatesOpen
    return {
      insightTemplatesOpen: nextOpen,
      insightGraphOpen: nextOpen ? false : state.insightGraphOpen,
    }
  }),
  setInsightTemplatesOpen: (open) => set({ insightTemplatesOpen: open }),
  toggleInsightOutline: () => set((state) => ({ insightOutlineOpen: !state.insightOutlineOpen })),
  toggleInsightLinks: () => set((state) => ({ insightLinksOpen: !state.insightLinksOpen })),
  setInsightSearchQuery: (query) => set({ insightSearchQuery: query }),
  setExploreSearchQuery: (query) => set({ exploreSearchQuery: query }),
  setSearchHighlight: (highlight) => set({ searchHighlight: highlight }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  toggleBottomPanel: () => set((state) => ({ bottomPanelOpen: !state.bottomPanelOpen })),
  toggleParentPanel: (open) => set({ parentPanelOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSettings: (settings) => set({ settings }),
  updateSettings: async (settings) => {
    let nextSettings = settings
    if (settings.knowledgeBase.directoryPath.trim()) {
      const repositorySettings = await updateRepositorySettingsApi(settings.knowledgeBase.directoryPath.trim())
      nextSettings = {
        ...settings,
        knowledgeBase: {
          ...settings.knowledgeBase,
          directoryPath: repositorySettings.repositoryRoot,
          directoryName: repositorySettings.repositoryRoot.split(/[/\\]/).pop() || repositorySettings.repositoryRoot,
        },
      }
    }

    set({ settings: nextSettings, settingsOpen: false, notice: 'Settings saved.' })
    await saveSettings(nextSettings)
  },
  updateKnowledgeBaseTemplates: async (templates) => {
    const nextSettings = {
      ...get().settings,
      knowledgeBase: {
        ...get().settings.knowledgeBase,
        templates,
      },
    }
    set({ settings: nextSettings, notice: 'Knowledge base templates updated.' })
    await saveSettings(nextSettings)
    try {
      await updateGlobalSettingsApi({ knowledgeBase: nextSettings.knowledgeBase })
    } catch (e) {
      console.warn('Failed to sync templates to backend:', e)
    }
  },
  updateProjectNodeContent: async (projectId, nodeId, updates) => {
    const targetProject = get().projects.find((project) => project.id === projectId)
    if (!targetProject) return

    const timestamp = new Date().toISOString()
    let updatedNode: KnoPathNode | null = null

    const nextProject = {
      ...targetProject,
      nodes: targetProject.nodes.map((node) => {
        if (node.id !== nodeId) return node

        updatedNode = {
          ...node,
          data: {
            ...node.data,
            ...updates,
            updatedAt: timestamp,
          },
        }

        return updatedNode
      }),
      updatedAt: timestamp,
    }

    if (!updatedNode) return
    set((state) => ({
      projects: state.projects.map((project) => (project.id === projectId ? nextProject : project)),
      currentProject: state.currentProject?.id === projectId ? nextProject : state.currentProject,
      markedNodes: state.currentProject?.id === projectId ? deriveMarkedNodes(nextProject) : state.markedNodes,
      notice: 'Insight content updated.',
    }))

    await saveProjectToBackend(nextProject)
  },
  setSummaryMode: (mode) => set({ summaryMode: mode }),
  setNotice: (message) => set({ notice: message }),
  setWorkspace: (workspace) => set({ currentWorkspace: workspace }),

  saveCurrentProject: async () => {
    const currentProject = get().currentProject
    if (!currentProject) return

    await saveProjectToBackend(currentProject)
    set({ syncStatus: 'synced' })
  },

  importFromRepository: async () => {
    try {
      const importedProjects = await importProjectsFromFiles()
      const syncedWikiGraph = await importWikiPagesFromFiles()

      const allProjects = await getProjectsApi()
      
      for (const project of allProjects) {
        const laidOutProject = autoLayoutProject(project)
        await saveProjectToBackend(laidOutProject)
      }

      const updatedProjects = await getProjectsApi()
      const normalizedProjects = updatedProjects.map(normalizeProject)
      const nextCurrentProject = normalizedProjects.find(
        (project) => project.id === get().currentProject?.id,
      ) ?? normalizedProjects[0] ?? null
      
      set({ 
        projects: normalizedProjects,
        currentProject: nextCurrentProject,
        focusedNodeId: nextCurrentProject ? get().focusedNodeId : null,
        markedNodes: deriveMarkedNodes(nextCurrentProject),
        wikiGraph: syncedWikiGraph,
        notice: importedProjects.length === 0 && syncedWikiGraph.pages.length === 0
          ? null
          : `Sync complete: ${importedProjects.length} projects, ${syncedWikiGraph.pages.length} wiki pages`,
      })

      return importedProjects.reduce((sum: number, p: Project) => sum + p.nodeCount, 0)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed'
      try {
        const allProjects = await getProjectsApi()
        const normalizedProjects = allProjects.map(normalizeProject)
        const nextCurrentProject = normalizedProjects.find(
          (project) => project.id === get().currentProject?.id,
        ) ?? normalizedProjects[0] ?? null
        set({
          projects: normalizedProjects,
          currentProject: nextCurrentProject,
          focusedNodeId: nextCurrentProject ? get().focusedNodeId : null,
          markedNodes: deriveMarkedNodes(nextCurrentProject),
          notice: message,
        })
      } catch {
        set({ notice: message })
      }
      return 0
    }
  },

  setCurrentProject: (project) => {
    const normalizedProject = project ? normalizeProject(project) : null
    set({ currentProject: normalizedProject, focusedNodeId: null, markedNodes: deriveMarkedNodes(normalizedProject) })
  },

  setProjects: (projects) => {
    set({ projects: projects.map(normalizeProject) })
  },

  loadWikiGraph: async () => {
    try {
      const graph = await getWikiGraph()
      set({ wikiGraph: graph })
    } catch {
      set({ wikiGraph: { pages: [], links: [] } })
    }
  },

  syncWikiPagesForProject: async (projectId) => {
    const state = get()
    const modelConfig = state.settings.model

    if (!modelConfig.apiKey.trim()) {
      set({ notice: 'Please configure API Key first to sync Wiki' })
      return
    }

    set({ wikiCompiling: true, insightSyncProgress: 'Starting wiki sync...' })

    try {
      const stream = streamSyncWikiPages(projectId, {
        apiKey: modelConfig.apiKey,
        baseUrl: modelConfig.baseUrl,
        model: modelConfig.model,
        temperature: modelConfig.temperature,
      })

      let successCount = 0
      let skippedCount = 0
      let totalCount = 0

      for await (const event of stream) {
        switch (event.type) {
          case 'start':
            totalCount = event.total
            set({ insightSyncProgress: `Syncing 0/${totalCount} pages...` })
            break
          case 'progress':
            set({ insightSyncProgress: `${event.status === 'checking' ? 'Checking' : 'Generating'} ${event.index}/${event.total}: ${event.node}` })
            break
          case 'page':
            if (event.status === 'skipped') {
              skippedCount += 1
              set({ insightSyncProgress: `Skipped existing Wiki page: ${event.title}` })
            } else {
              successCount += 1
              set({ insightSyncProgress: `Generated ${successCount}/${event.total}: ${event.title}` })
            }
            break
          case 'complete':
            successCount = event.success
            skippedCount = event.skipped ?? skippedCount
            break
          case 'error':
            set({ insightSyncProgress: `Error: ${event.message}` })
            break
          case 'retry':
            set({ insightSyncProgress: `Retrying node ${event.node_id.slice(0, 8)}... (attempt ${event.attempt})` })
            break
          case 'node_failed':
            set({ insightSyncProgress: `Node ${event.node_id.slice(0, 8)} failed: ${event.error}` })
            break
        }
      }

      const graph = await getWikiGraph()
      set({
        wikiGraph: graph,
        wikiCompiling: false,
        insightSyncProgress: null,
        notice: `Wiki sync complete: ${successCount} generated, ${skippedCount} skipped`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wiki sync failed'
      set({ wikiCompiling: false, insightSyncProgress: null, notice: message })
    }
  },

  compileWikiForProject: async (projectId) => {
    const state = get()
    const modelConfig = state.settings.model

    if (!modelConfig.apiKey.trim()) {
      set({ notice: 'Please configure API Key first to compile Wiki' })
      return
    }

    set({ wikiCompiling: true, notice: 'Compiling Wiki links...' })

    try {
      const graph = await compileWikiApi(projectId, {
        apiKey: modelConfig.apiKey,
        baseUrl: modelConfig.baseUrl,
        model: modelConfig.model,
        temperature: modelConfig.temperature,
      })

      set({
        wikiGraph: graph,
        wikiCompiling: false,
        notice: `Wiki compiled: ${graph.pages.length} pages, ${graph.links.length} links`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wiki compilation failed'
      set({ wikiCompiling: false, notice: message })
    }
  },

  deleteWikiPage: async (pageId) => {
    try {
      await deleteWikiPageApi(pageId)
      set((state) => {
        if (!state.wikiGraph) return state
        return {
          wikiGraph: {
            pages: state.wikiGraph.pages.filter((p) => p.id !== pageId),
            links: state.wikiGraph.links.filter((l) => l.sourcePageId !== pageId && l.targetPageId !== pageId),
          },
          selectedWikiPageId: state.selectedWikiPageId === pageId ? null : state.selectedWikiPageId,
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete Wiki page'
      set({ notice: message })
    }
  },

  deleteWikiPageLocal: async (pageId) => {
    try {
      await deleteWikiPageLocalApi(pageId)
      set({ notice: 'Local file deleted' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete local file'
      set({ notice: message })
    }
  },

  setSelectedWikiPageId: (pageId) => set({ selectedWikiPageId: pageId }),

  toggleInsightGraph: () => set((state) => {
    const nextOpen = !state.insightGraphOpen
    return {
      insightGraphOpen: nextOpen,
      insightTemplatesOpen: nextOpen ? false : state.insightTemplatesOpen,
    }
  }),

  validateAndLoadRepository: async () => {
    const currentSettings = get().settings
    const directoryPath = currentSettings.knowledgeBase.directoryPath
    
    if (!directoryPath) {
      return
    }
    
    if (isElectron()) {
      try {
        const exists = await pathExistsElectron(directoryPath)
        
        if (!exists) {
          const newSettings = {
            ...currentSettings,
            knowledgeBase: {
              ...currentSettings.knowledgeBase,
              directoryPath: '',
              directoryName: '',
            },
          }
          set({ settings: newSettings })
          await saveSettings(newSettings)
        }
      } catch (error) {
        console.error('Failed to validate local repository:', error)
      }
    }
  },

  resetRepositoryPath: () => {
    const currentSettings = get().settings
    const newSettings = {
      ...currentSettings,
      knowledgeBase: {
        ...currentSettings.knowledgeBase,
        directoryPath: '',
        directoryName: '',
      },
    }
    set({ settings: newSettings })
    void saveSettings(newSettings)
  },

  streamSyncInsight: async (projectId: string) => {
    const state = get()
    const modelConfig = state.settings.model

    if (!modelConfig.apiKey.trim()) {
      set({ notice: 'Please configure API Key in settings first' })
      return
    }

    // Cancel any existing sync first
    if (_insightSyncAbortController) {
      _insightSyncAbortController.abort()
    }

    const controller = new AbortController()
    _insightSyncAbortController = controller

    set({ insightSyncing: true, insightSyncProgress: 'Preparing to generate Wiki pages...' })

    try {
      for await (const event of streamSyncWikiPages(projectId, {
        apiKey: modelConfig.apiKey,
        baseUrl: modelConfig.baseUrl,
        model: modelConfig.model,
        temperature: modelConfig.temperature,
      }, controller.signal)) {
        if (event.type === 'start') {
          set({ insightSyncProgress: `Starting to generate ${event.total} Wiki pages...` })
        } else if (event.type === 'progress') {
          set({ insightSyncProgress: `[${event.index}/${event.total}] ${event.status === 'checking' ? 'Checking' : 'Generating'}: ${event.node}` })
        } else if (event.type === 'page') {
          set({
            insightSyncProgress: event.status === 'skipped'
              ? `[${event.index}/${event.total}] Skipped existing: ${event.title}`
              : `[${event.index}/${event.total}] Generated: ${event.title}`,
          })
        } else if (event.type === 'complete') {
          set({
            insightSyncProgress: `Wiki sync complete: ${event.success} generated, ${event.skipped ?? 0} skipped`,
            notice: `Wiki sync complete: ${event.success} generated, ${event.skipped ?? 0} skipped`,
          })
          await get().loadWikiGraph()
          window.setTimeout(() => {
            set({ insightSyncProgress: null })
          }, 3200)
        } else if (event.type === 'retry') {
          set({ insightSyncProgress: `[Retry] Node ${event.node_id?.slice(0, 8)} (attempt ${event.attempt})` })
        } else if (event.type === 'node_failed') {
          set({ notice: `Node failed: ${event.node_id?.slice(0, 8)} - ${event.error}`, insightSyncProgress: `[Failed] Node ${event.node_id?.slice(0, 8)}: ${event.error}` })
        } else if (event.type === 'error') {
          set({ notice: `Error: ${event.message}`, insightSyncProgress: `Error: ${event.message}` })
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        set({ notice: 'Insight compilation cancelled', insightSyncProgress: null })
      } else {
        const message = error instanceof Error ? error.message : 'Insight compilation failed.'
        set({ notice: message, insightSyncProgress: message })
      }
    } finally {
      _insightSyncAbortController = null
      set({ insightSyncing: false })
    }
  },

  cancelInsightSync: () => {
    if (_insightSyncAbortController) {
      _insightSyncAbortController.abort()
      _insightSyncAbortController = null
    }
  },

  setExplorationOverlay: (overlay) => {
    set({ explorationOverlay: overlay })
  },

  setNodeContextMenu: (menu) => {
    set({ nodeContextMenu: menu })
  },
}))
