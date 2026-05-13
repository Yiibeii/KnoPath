import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type ReactFlowInstance,
  type NodeTypes,
} from '@xyflow/react'
import { ArrowDownRight, ArrowRight, BrainCircuit, Compass, Maximize2, Minimize2, Plus, RefreshCw, Save, Target, Wand2 } from 'lucide-react'
import '@xyflow/react/dist/style.css'

import { saveProjectToBackend } from '../lib/api'
import { t } from '../lib/i18n'
import { getNodeViewportCenter } from '../lib/canvasFocus'
import { useStore } from '../store'
import type { KnoPathEdge, KnoPathNode as KnoPathNodeType, ExplorationDirection } from '../types'
import KnoPathNode from './KnoPathNode'

const nodeTypes: NodeTypes = {
  knopath: KnoPathNode,
}

export default function Canvas() {
  const locale = useStore((s) => s.settings.locale ?? 'zh')
  const reactFlow = useReactFlow<KnoPathNodeType, KnoPathEdge>()
  const { 
    createNode, 
    currentProject, 
    focusedNodeId, 
    layoutAnimating, 
    layoutRevision,
    setFocusedNode,
    updateNodePosition,
    notice,
    explorationOverlay,
    setExplorationOverlay,
    nodeContextMenu,
    setNodeContextMenu,
  } = useStore()
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({})
  const lastCenteredNodeKeyRef = useRef<string | null>(null)
  const lastFitLayoutRevisionRef = useRef<number>(0)
  const lastFitProjectIdRef = useRef<string | null>(null)
  const renderedNodesRef = useRef<
    Map<
      string,
      {
        sourceNode: KnoPathNodeType
        viewNode: KnoPathNodeType
        hidden: boolean
        positionX: number
        positionY: number
        isFocused: boolean
        hasActiveFocus: boolean
        nodeDepth: number
        layoutAnimating: boolean
      }
    >
  >(new Map())

  const nodes = useMemo(() => {
    if (!currentProject) return []

    const childrenByParent = new Map<string | null, typeof currentProject.nodes>()
    for (const node of currentProject.nodes) {
      const siblings = childrenByParent.get(node.data.parentId) ?? []
      siblings.push(node)
      childrenByParent.set(node.data.parentId, siblings)
    }

    const hiddenSet = new Set<string>()
    const depthMap = new Map<string, number>()
    const stack = (childrenByParent.get(null) ?? []).map((node) => ({
      node,
      depth: 0,
      hidden: false,
    }))

    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue

      depthMap.set(current.node.id, current.depth)
      if (current.hidden) hiddenSet.add(current.node.id)

      const children = childrenByParent.get(current.node.id) ?? []
      for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = children[childIndex]
        stack.push({
          node: child,
          depth: current.depth + 1,
          hidden: current.hidden || current.node.data.isBranchCollapsed,
        })
      }
    }

    const nextRenderedNodes = new Map<string, KnoPathNodeType>()
    const hasActiveFocus = Boolean(focusedNodeId)

    for (const node of currentProject.nodes) {
      const dragPosition = dragPositions[node.id]
      const positionX = dragPosition?.x ?? node.position.x
      const positionY = dragPosition?.y ?? node.position.y
      const isFocused = focusedNodeId === node.id
      const hidden = hiddenSet.has(node.id)
      const nodeDepth = depthMap.get(node.id) ?? 0
      const cached = renderedNodesRef.current.get(node.id)

      if (
        cached &&
        cached.sourceNode === node &&
        cached.hidden === hidden &&
        cached.positionX === positionX &&
        cached.positionY === positionY &&
        cached.isFocused === isFocused &&
        cached.hasActiveFocus === hasActiveFocus &&
        cached.nodeDepth === nodeDepth &&
        cached.layoutAnimating === layoutAnimating
      ) {
        nextRenderedNodes.set(node.id, cached.viewNode)
        continue
      }

      const viewNode = {
        ...node,
        position: { x: positionX, y: positionY },
        width: 290,
        height: node.data.isNodeCollapsed ? 176 : 280,
        className: layoutAnimating ? 'layout-animating' : undefined,
        data: {
          ...node.data,
          isFocused,
          hasActiveFocus,
          nodeDepth,
        },
        hidden,
      }

      renderedNodesRef.current.set(node.id, {
        sourceNode: node,
        viewNode,
        hidden,
        positionX,
        positionY,
        isFocused,
        hasActiveFocus,
        nodeDepth,
        layoutAnimating,
      })
      nextRenderedNodes.set(node.id, viewNode)
    }

    renderedNodesRef.current = new Map(
      currentProject.nodes.map((node) => [node.id, renderedNodesRef.current.get(node.id)!]),
    )

    return currentProject.nodes.map((node) => nextRenderedNodes.get(node.id)!)
  }, [currentProject, dragPositions, focusedNodeId, layoutAnimating, layoutRevision])

  useEffect(() => {
    if (!currentProject || layoutRevision === 0) return
    if (lastFitLayoutRevisionRef.current === layoutRevision) return

    const frame = requestAnimationFrame(() => {
      lastFitLayoutRevisionRef.current = layoutRevision
      reactFlow.fitView({
        padding: 0.2,
        duration: 420,
        maxZoom: 1.15,
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [currentProject, layoutRevision])

  useEffect(() => {
    if (!currentProject) return
    if (lastFitProjectIdRef.current === currentProject.id) return

    const frame = requestAnimationFrame(() => {
      lastFitProjectIdRef.current = currentProject.id
      reactFlow.fitView({
        padding: 0.2,
        duration: 420,
        maxZoom: 1.15,
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [currentProject])

  useEffect(() => {
    if (!focusedNodeId) {
      lastCenteredNodeKeyRef.current = null
      return
    }

    const focusedNode = nodes.find((node) => node.id === focusedNodeId)
    if (!focusedNode || focusedNode.hidden) {
      lastCenteredNodeKeyRef.current = null
      return
    }

    const centerKey = `${focusedNode.id}:${focusedNode.position.x}:${focusedNode.position.y}:${focusedNode.height ?? 0}`
    if (lastCenteredNodeKeyRef.current === centerKey) return

    lastCenteredNodeKeyRef.current = centerKey

    const frame = requestAnimationFrame(() => {
      const { x, y } = getNodeViewportCenter(focusedNode)
      reactFlow.setCenter(x, y, {
        zoom: 1.2,
        duration: 400,
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [focusedNodeId, nodes])

  const handleFocusNode = (nodeId: string) => {
    setFocusedNode(nodeId)
  }

  if (!currentProject) return null

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={currentProject.edges}
        onNodeDrag={(_, node) => {
          setDragPositions((current) => ({ ...current, [node.id]: node.position }))
        }}
        onNodeDragStop={(_, node) => {
          setDragPositions((current) => {
            const next = { ...current }
            delete next[node.id]
            return next
          })
          void updateNodePosition(node.id, node.position.x, node.position.y)
        }}
        onNodeClick={(_, node) => {
          handleFocusNode(node.id)
        }}
        onPaneClick={() => { setFocusedNode(null); setNodeContextMenu(null) }}
        onNodeContextMenu={(event, node) => {
          console.log('[Canvas] Right-click on node:', node.id)
          console.log('[Canvas] node.data.exploration:', node.data.exploration)

          const hasExploration = node.data.exploration && (
            (node.data.exploration.deep?.length ?? 0) > 0 ||
            (node.data.exploration.lateral?.length ?? 0) > 0 ||
            (node.data.exploration.applied?.length ?? 0) > 0
          )
          console.log('[Canvas] hasExploration:', hasExploration)

          event.preventDefault()
          setNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
          setExplorationOverlay(null)
        }}
        nodeTypes={nodeTypes}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'default',
          animated: true,
        }}
        proOptions={{ hideAttribution: true }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="oklch(0.88 0.015 100)" />
        <Controls className="!rounded-card !border-white/30 !bg-white/60 !backdrop-blur-xl !shadow-[0_8px_32px_rgba(23,23,28,0.08)]" />
        <MiniMap
          className="!rounded-card !border !border-white/30 !bg-white/60 !backdrop-blur-xl !shadow-[0_8px_32px_rgba(23,23,28,0.08)]"
          style={{ width: 220, height: 140 }}
          bgColor={document.documentElement.dataset.theme === 'dark' ? 'rgba(30,30,40,0.63)' : 'rgba(255,255,255,0.6)'}
          pannable
          zoomable
          nodeColor={(node) => {
            if (node.data?.isFocused) return '#1863dc'
            if (node.data?.isMarked) return 'oklch(0.5234 0.1347 144.1672)'
            return '#d9d9dd'
          }}
          nodeStrokeColor={(node) => {
            if (node.data?.isFocused) return '#0f4db4'
            return '#c9c9d2'
          }}
          nodeBorderRadius={10}
          nodeStrokeWidth={3}
          maskColor={document.documentElement.dataset.theme === 'dark' ? 'rgba(30,30,40,0.82)' : 'rgba(255,255,255,0.82)'}
          maskStrokeColor="rgba(24, 99, 220, 0.26)"
          maskStrokeWidth={1.5}
          offsetScale={18}
          ariaLabel="Knowledge tree minimap"
        />
      </ReactFlow>

      <CanvasFloatingToolbar />

      {nodeContextMenu && (() => {
        const node = currentProject.nodes.find((n) => n.id === nodeContextMenu.nodeId)
        if (!node) {
          console.log('[Canvas] Node not found for context menu:', nodeContextMenu.nodeId)
          return null
        }
        const hasExploration = node.data.exploration && (
          (node.data.exploration.deep?.length ?? 0) > 0 ||
          (node.data.exploration.lateral?.length ?? 0) > 0 ||
          (node.data.exploration.applied?.length ?? 0) > 0
        )
        console.log('[Canvas] Rendering context menu for node:', node.id)
        console.log('[Canvas] hasExploration:', hasExploration)
        return (
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onClick={() => setNodeContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setNodeContextMenu(null) }}
            />
            <div
              className="fixed z-[9999] min-w-[220px] rounded-[16px] border border-white/30 bg-white/70 p-2 shadow-menu backdrop-blur-xl"
              style={{ left: nodeContextMenu.x, top: nodeContextMenu.y + 6 }}
            >
              <button
                onClick={() => {
                  setFocusedNode(nodeContextMenu.nodeId)
                  void createNode(nodeContextMenu.nodeId, '')
                  setNodeContextMenu(null)
                }}
                className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-sm text-near-black transition-all duration-200 hover:bg-olive-highlight"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-olive-accent/10">
                  <Compass size={14} className="text-olive-accent" />
                </div>
                <span className="font-medium">{t(locale, 'newBranch')}</span>
              </button>
              {hasExploration && (
                <>
                  <div className="mx-2 my-1.5 border-t border-white/20" />
                  {(['deep', 'lateral', 'applied'] as ExplorationDirection[]).map((direction) => {
                    const options = node.data.exploration?.[direction] ?? []
                    if (options.length === 0) return null
                    const getLabel = (d: ExplorationDirection) => {
                      switch (d) {
                        case 'deep': return t(locale, 'deepDive')
                        case 'lateral': return t(locale, 'lateralExplore')
                        case 'applied': return t(locale, 'appliedScenarios')
                      }
                    }
                    const getIcon = (d: ExplorationDirection) => {
                      switch (d) {
                        case 'deep': return <ArrowDownRight size={14} />
                        case 'lateral': return <ArrowRight size={14} />
                        case 'applied': return <Target size={14} />
                      }
                    }
                    const getColor = (d: ExplorationDirection) => {
                      switch (d) {
                        case 'deep': return { bg: 'bg-blue-50', text: 'text-blue-600', icon: 'text-blue-500' }
                        case 'lateral': return { bg: 'bg-purple-50', text: 'text-purple-600', icon: 'text-purple-500' }
                        case 'applied': return { bg: 'bg-amber-50', text: 'text-amber-600', icon: 'text-amber-500' }
                      }
                    }
                    const colors = getColor(direction)
                    return (
                      <button
                        key={direction}
                        onClick={() => {
                          setNodeContextMenu(null)
                          setExplorationOverlay({
                            nodeId: nodeContextMenu.nodeId,
                            direction,
                            options,
                          })
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-left text-sm text-near-black transition-all duration-200 hover:bg-olive-highlight"
                      >
                        <span className="flex items-center gap-2.5">
                          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${colors.bg}`}>
                            <span className={colors.icon}>{getIcon(direction)}</span>
                          </div>
                          <span className="font-medium">{getLabel(direction)}</span>
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${colors.bg} ${colors.text}`}>
                          {options.length}
                        </span>
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )
      })()}

      {notice ? (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 max-w-[90vw] -translate-x-1/2 truncate rounded-pill border border-white/30 bg-white/70 px-5 py-2.5 text-sm font-medium text-near-black shadow-menu backdrop-blur-xl">
          {notice}
        </div>
      ) : null}

      {explorationOverlay && (
        console.log('[Canvas] Rendering ExplorationOverlay:', explorationOverlay),
        <ExplorationOverlayComponent
          overlay={explorationOverlay}
          nodes={currentProject.nodes}
          flowInstance={reactFlow}
          onClose={() => setExplorationOverlay(null)}
          onCreateBranch={async (option: string) => {
            console.log('[Canvas] Creating branch from exploration:', option)
            setExplorationOverlay(null)
            const store = useStore.getState()
            const explorationMode = store.settings.explorationMode ?? 'direct'
            const directionLabel = explorationOverlay.direction === 'deep' ? t(locale, 'deepDive') + ': ' : explorationOverlay.direction === 'lateral' ? t(locale, 'lateralExplore') + ': ' : t(locale, 'appliedScenarios') + ': '
            const question = `${directionLabel}${option}`
            if (explorationMode === 'prompt') {
              const newNodeId = await store.createNode(explorationOverlay.nodeId, '')
              if (newNodeId) {
                await store.updateNodeQuestion(newNodeId, question)
              }
            } else {
              const newNodeId = await store.createNode(explorationOverlay.nodeId, question)
              if (newNodeId) {
                store.generateNodeAnswer(newNodeId)
              }
            }
          }}
        />
      )}

      {currentProject.nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto rounded-card border border-white/30 bg-white/65 px-10 py-9 text-center shadow-panel backdrop-blur-xl">
            <div className="mb-3 font-display text-[32px] leading-none tracking-[-0.03em] text-cohere-black">{t(locale, 'startWithRoot')}</div>
            <div className="max-w-md text-[15px] leading-relaxed text-muted-slate">
              {t(locale, 'createFirstDesc')}
            </div>
            <button
              onClick={() => void createNode(null, '')}
              className="mt-6 inline-flex items-center rounded-card bg-cohere-black px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 shadow-btn hover:bg-deep-dark hover:shadow-btn-hover hover:translate-y-[-1px]"
            >
              {t(locale, 'createRootNode')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CanvasFloatingToolbar() {
  const locale = useStore((s) => s.settings.locale ?? 'zh')
  const {
    autoLayoutCurrentProject,
    createNode,
    currentProject,
    focusedNodeId,
    setNotice,
    toggleAllNodesCollapsed,
  } = useStore()
  const [isCompact, setIsCompact] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const insightSyncing = useStore((state) => state.insightSyncing)
  const insightSyncProgress = useStore((state) => state.insightSyncProgress)
  const streamSyncInsight = useStore((state) => state.streamSyncInsight)
  const cancelInsightSync = useStore((state) => state.cancelInsightSync)
  const markedNodes = useStore((state) => state.markedNodes)
  const markedProjectNodes = useMemo(() => {
    if (!currentProject) return []
    const markedIds = new Set(markedNodes.map((node) => node.nodeId))
    return currentProject.nodes.filter((node) => markedIds.has(node.id))
  }, [currentProject, markedNodes])

  const handleCreateBranch = () => {
    if (!currentProject) return
    if (currentProject.nodes.length === 0) {
      void createNode(null, '')
      return
    }
    if (!focusedNodeId) {
      setNotice(t(locale, 'selectNodeFirst'))
      return
    }
    void createNode(focusedNodeId, '')
  }

  const handleSave = async () => {
    if (!currentProject) return

    setIsSaving(true)
    try {
      const result = await saveProjectToBackend(currentProject)
      setNotice(t(locale, 'projectSaved', result.nodeCount, result.filesSaved))
    } catch (error) {
      const message = error instanceof Error ? error.message : t(locale, 'saveFailed')
      setNotice(message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCompileInsight = async () => {
    if (!currentProject) return
    await streamSyncInsight(currentProject.id)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (currentProject && !isSaving) {
          void handleSave()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentProject, isSaving])

  if (!currentProject) return null

  const canCompileInsight = markedProjectNodes.length > 0
  const showLabels = !isCompact
  const branchLabel = currentProject.nodes.length === 0 ? t(locale, 'rootNodeLabel') : t(locale, 'quickBranch')

  return (
    <div className="pointer-events-none absolute left-0 right-0 top-5 z-30 flex justify-center px-5">
      <div
        className={[
          'pointer-events-auto flex items-center rounded-card border border-white/30 bg-white/65 shadow-overlay backdrop-blur-xl transition-all duration-200',
          isCompact ? 'gap-0.5 p-1' : 'gap-1 p-1.5',
        ].join(' ')}
      >
        <CanvasToolbarButton onClick={handleCreateBranch} title={branchLabel} icon={<Plus size={15} />} showLabel={showLabels}>
          {branchLabel}
        </CanvasToolbarButton>

        <CanvasToolbarButton
          onClick={() => void autoLayoutCurrentProject()}
          onDoubleClick={() => void toggleAllNodesCollapsed()}
          title={t(locale, 'autoLayoutTitle')}
          icon={<Wand2 size={15} />}
          showLabel={showLabels}
        >
          {t(locale, 'autoLayout')}
        </CanvasToolbarButton>

        <div className="mx-1 h-5 w-px bg-border-cool" />

        <div className="relative">
          <CanvasToolbarButton
            onClick={() => insightSyncing ? cancelInsightSync() : void handleCompileInsight()}
            disabled={!insightSyncing && !canCompileInsight}
            title={insightSyncing ? t(locale, 'cancel') : t(locale, 'compileInsights')}
            icon={insightSyncing ? <RefreshCw size={15} className="animate-spin" /> : <BrainCircuit size={15} />}
            showLabel={showLabels}
            accent={canCompileInsight}
            success={Boolean(insightSyncProgress && !insightSyncing)}
          >
            {insightSyncing
              ? t(locale, 'cancel')
              : insightSyncProgress
                ? t(locale, 'done')
                : `Insight${markedProjectNodes.length > 0 ? ` ${markedProjectNodes.length}` : ''}`}
          </CanvasToolbarButton>
        </div>

        <CanvasToolbarButton
          onClick={() => void handleSave()}
          disabled={isSaving}
          title={t(locale, 'saveProject')}
          icon={isSaving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          showLabel={showLabels}
        >
          {t(locale, 'save2')}
        </CanvasToolbarButton>

        <div className="mx-1 h-5 w-px bg-border-cool" />

        <button
          onClick={() => setIsCompact((current) => !current)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-card-sm text-muted-slate transition-all duration-200 hover:bg-white/50 hover:text-cohere-black"
          title={isCompact ? t(locale, 'expandToolbar') : t(locale, 'shrinkToolbar')}
        >
          {isCompact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </button>
      </div>
    </div>
  )
}

function CanvasToolbarButton({
  accent = false,
  children,
  disabled = false,
  icon,
  onClick,
  onDoubleClick,
  showLabel,
  success = false,
  title,
}: {
  accent?: boolean
  children: string
  disabled?: boolean
  icon: ReactNode
  onClick: () => void
  onDoubleClick?: () => void
  showLabel: boolean
  success?: boolean
  title: string
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={disabled}
      title={title}
      className={[
        'inline-flex h-9 items-center justify-center gap-2 rounded-card-sm px-3 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        showLabel ? 'min-w-0' : 'w-9 px-0',
        success
          ? 'bg-emerald-50 text-emerald-700'
          : accent
            ? 'bg-olive-accent/10 text-olive-accent hover:bg-olive-accent/15'
            : 'text-near-black hover:bg-olive-highlight hover:text-olive-accent',
      ].join(' ')}
    >
      {icon}
      {showLabel ? <span className="whitespace-nowrap">{children}</span> : null}
    </button>
  )
}

function ExplorationOverlayComponent({
  overlay,
  nodes,
  flowInstance,
  onClose,
  onCreateBranch,
}: {
  overlay: { nodeId: string; direction: ExplorationDirection; options: string[] }
  nodes: KnoPathNodeType[]
  flowInstance: ReactFlowInstance<KnoPathNodeType, KnoPathEdge>
  onClose: () => void
  onCreateBranch: (option: string) => Promise<void>
}) {
  const locale = useStore((s) => s.settings.locale ?? 'zh')
  const node = nodes.find((n) => n.id === overlay.nodeId)
  if (!node) return null

  const screenPos = flowInstance.flowToScreenPosition(node.position)
  const nodeWidth = node.width ?? 300

  const getDirectionLabel = (direction: ExplorationDirection) => {
    switch (direction) {
      case 'deep': return t(locale, 'deepDive')
      case 'lateral': return t(locale, 'lateralExplore')
      case 'applied': return t(locale, 'appliedScenarios')
    }
  }

  const [editValues, setEditValues] = useState<string[]>(overlay.options)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const handleSelect = (index: number) => {
    setSelectedIndex(index)
    setEditingIndex(null)
  }

  const handleDoubleClick = (index: number) => {
    setEditingIndex(index)
  }

  const handleConfirm = async () => {
    if (selectedIndex !== null) {
      await onCreateBranch(editValues[selectedIndex])
    }
  }

  const handleEdit = (index: number, value: string) => {
    const newValues = [...editValues]
    newValues[index] = value
    setEditValues(newValues)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setEditingIndex(null)
    }
  }

  const panelX = screenPos.x + nodeWidth + 24
  const panelY = screenPos.y

  const getDirectionColor = (direction: ExplorationDirection) => {
    switch (direction) {
      case 'deep': return { bg: 'bg-blue-50', text: 'text-blue-600', icon: 'text-blue-500', accent: 'bg-blue-500', border: 'border-blue-200' }
      case 'lateral': return { bg: 'bg-purple-50', text: 'text-purple-600', icon: 'text-purple-500', accent: 'bg-purple-500', border: 'border-purple-200' }
      case 'applied': return { bg: 'bg-amber-50', text: 'text-amber-600', icon: 'text-amber-500', accent: 'bg-amber-500', border: 'border-amber-200' }
    }
  }

  const colors = getDirectionColor(overlay.direction)

  const getDirectionIcon = (direction: ExplorationDirection) => {
    switch (direction) {
      case 'deep': return <ArrowDownRight size={14} />
      case 'lateral': return <ArrowRight size={14} />
      case 'applied': return <Target size={14} />
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9997]"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose() }}
    >
      <div
        className="fixed w-[340px] rounded-[16px] border border-white/30 bg-white/70 shadow-menu backdrop-blur-xl"
        style={{ left: panelX, top: panelY }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${colors.bg}`}>
              <span className={colors.icon}>{getDirectionIcon(overlay.direction)}</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-near-black">
                {getDirectionLabel(overlay.direction)}
              </div>
              <div className="text-[11px] text-muted-slate">
                {t(locale, 'selectOrEdit')}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-[8px] p-1.5 text-muted-slate hover:bg-olive-highlight hover:text-near-black transition-all duration-200"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="max-h-[320px] overflow-y-auto p-2">
          {editValues.map((option, index) => (
            <div
              key={index}
              className={`mb-1.5 rounded-[12px] border p-3 cursor-pointer transition-all duration-200 ${
                selectedIndex === index
                  ? `${colors.border} ${colors.bg} shadow-float`
                  : 'border-white/30 hover:border-white/50 hover:bg-olive-highlight'
              }`}
              onClick={() => handleSelect(index)}
              onDoubleClick={() => handleDoubleClick(index)}
            >
              {editingIndex === index ? (
                <input
                  type="text"
                  value={option}
                  onChange={(e) => handleEdit(index, e.target.value)}
                  onBlur={() => setEditingIndex(null)}
                  onKeyDown={(e) => handleKeyDown(e)}
                  autoFocus
                  className="w-full bg-transparent text-sm text-near-black outline-none placeholder:text-muted-slate"
                  placeholder={t(locale, 'enterExplorationTopic')}
                />
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${
                    selectedIndex === index ? `${colors.bg}` : 'bg-white/40'
                  }`}>
                    <span className={`text-[11px] font-semibold tabular-nums ${
                      selectedIndex === index ? colors.text : 'text-muted-slate'
                    }`}>{index + 1}</span>
                  </div>
                  <div className={`text-sm font-medium ${
                    selectedIndex === index ? colors.text : 'text-near-black'
                  }`}>{option}</div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/20 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-[8px] px-3.5 py-1.5 text-sm font-medium text-muted-slate hover:bg-olive-highlight hover:text-near-black transition-all duration-200"
          >
            {t(locale, 'cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIndex === null}
            className={`rounded-[8px] px-4 py-1.5 text-sm font-semibold transition-all duration-200 ${
              selectedIndex !== null
                ? `${colors.accent} text-white hover:opacity-90 shadow-btn`
                : 'bg-border-subtle text-muted-slate cursor-not-allowed'
            }`}
          >
            {t(locale, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
