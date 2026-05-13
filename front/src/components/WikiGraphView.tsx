import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, BookOpen, Loader2, Trash2, X } from 'lucide-react'

import { LINK_TYPE_COLORS, LINK_TYPE_LABELS } from '../lib/insightUtils'
import {
  wikiGraphNodeTypes,
  buildWikiGraphNodes,
  buildWikiGraphEdges,
} from '../lib/wikiGraphShared'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import MarkdownContent from './MarkdownContent'
import type { WikiPage } from '../types'

function WikiPageDetail({ page, onClose, onDelete, onJumpToNode }: { page: WikiPage; onClose: () => void; onDelete: () => void; onJumpToNode: (projectId: string, nodeId: string) => void }) {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const { wikiGraph } = useStore()

  const relatedLinks = useMemo(() => {
    if (!wikiGraph) return { incoming: [], outgoing: [] }
    return {
      incoming: wikiGraph.links.filter((l) => l.targetPageId === page.id),
      outgoing: wikiGraph.links.filter((l) => l.sourcePageId === page.id),
    }
  }, [wikiGraph, page.id])

  const pageMap = useMemo(() => {
    if (!wikiGraph) return new Map<string, WikiPage>()
    return new Map(wikiGraph.pages.map((p) => [p.id, p]))
  }, [wikiGraph])

  return (
    <div className="absolute bottom-4 right-4 z-10 w-[380px] max-h-[80vh] overflow-y-auto rounded-card border border-white/30 bg-white/65 p-5 shadow-panel backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'wikiPageLabel')}</div>
          <h2 className="mt-1 font-display text-xl tracking-[-0.03em] text-cohere-black">{page.title}</h2>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-full p-1 text-muted-slate transition-colors hover:bg-white/50 hover:text-cohere-black">
          <X size={16} />
        </button>
      </div>

      {page.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {page.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-olive-accent/10 px-2.5 py-1 text-[11px] font-medium text-olive-accent">
              {tag}
            </span>
          ))}
        </div>
      )}

      {page.content && (
        <div className="mt-4 rounded-card bg-white/40 p-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'content')}</div>
          <div className="mt-2">
            <MarkdownContent content={page.content} className="text-sm leading-relaxed text-near-black" />
          </div>
        </div>
      )}

      {page.sourceProjectId && page.sourceNodeId && (
        <button
          onClick={() => onJumpToNode(page.sourceProjectId!, page.sourceNodeId!)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-olive-accent px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 shadow-btn hover:shadow-btn-hover hover:bg-olive-accent/90"
        >
          <ArrowRight size={14} />
          {t(locale, 'jumpToSourceNode')}
        </button>
      )}

      {(relatedLinks.incoming.length > 0 || relatedLinks.outgoing.length > 0) && (
        <div className="mt-4 space-y-3">
          {relatedLinks.outgoing.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'outgoingLinks')}</div>
              <div className="mt-2 space-y-1.5">
                {relatedLinks.outgoing.map((link) => {
                  const target = pageMap.get(link.targetPageId)
                  return (
                    <div key={link.id} className="flex items-center gap-2 rounded-card bg-white/40 px-3 py-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: LINK_TYPE_COLORS[link.linkType] || LINK_TYPE_COLORS.reference }} />
                      <span className="text-sm text-cohere-black">{target?.title || t(locale, 'unknown')}</span>
                      <span className="ml-auto text-[10px] text-muted-slate">{LINK_TYPE_LABELS[link.linkType] || link.linkType}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {relatedLinks.incoming.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'incomingLinks')}</div>
              <div className="mt-2 space-y-1.5">
                {relatedLinks.incoming.map((link) => {
                  const source = pageMap.get(link.sourcePageId)
                  return (
                    <div key={link.id} className="flex items-center gap-2 rounded-card bg-white/40 px-3 py-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: LINK_TYPE_COLORS[link.linkType] || LINK_TYPE_COLORS.reference }} />
                      <span className="text-sm text-cohere-black">{source?.title || t(locale, 'unknown')}</span>
                      <span className="ml-auto text-[10px] text-muted-slate">{LINK_TYPE_LABELS[link.linkType] || link.linkType}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={onDelete}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] border border-red-200 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-50"
      >
        <Trash2 size={14} />
        {t(locale, 'deleteThisWikiPage')}
      </button>
    </div>
  )
}

export default function WikiGraphView() {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const {
    wikiGraph,
    wikiCompiling,
    selectedWikiPageId,
    currentProject,
    loadWikiGraph,
    compileWikiForProject,
    deleteWikiPage,
    setSelectedWikiPageId,
    setWorkspace,
    selectProject,
    setFocusedNode,
  } = useStore()

  useEffect(() => {
    void loadWikiGraph()
  }, [loadWikiGraph])

  const onSelectPage = useCallback(
    (pageId: string) => {
      const current = useStore.getState().selectedWikiPageId
      setSelectedWikiPageId(current === pageId ? null : pageId)
    },
    [setSelectedWikiPageId],
  )

  const graphNodes = useMemo(
    () => buildWikiGraphNodes(wikiGraph.pages, selectedWikiPageId, onSelectPage),
    [wikiGraph.pages, selectedWikiPageId, onSelectPage],
  )

  const graphEdges = useMemo(() => buildWikiGraphEdges(wikiGraph.links), [wikiGraph.links])

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState(graphNodes)
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState(graphEdges)

  useEffect(() => {
    setRfNodes(graphNodes)
    setRfEdges(graphEdges)
  }, [graphNodes, graphEdges, setRfNodes, setRfEdges])

  const selectedPage = useMemo(
    () => wikiGraph.pages.find((p) => p.id === selectedWikiPageId) ?? null,
    [wikiGraph, selectedWikiPageId],
  )

  const handleCompile = useCallback(async () => {
    if (!currentProject) return
    await compileWikiForProject(currentProject.id)
  }, [currentProject, compileWikiForProject])

  const handleJumpToNode = useCallback(
    async (projectId: string, nodeId: string) => {
      try {
        if (currentProject?.id !== projectId) {
          await selectProject(projectId)
        }
      } catch {
        // Even if project load fails, still attempt navigation
      }
      setWorkspace('explore')
      setFocusedNode(nodeId)
    },
    [currentProject, selectProject, setWorkspace, setFocusedNode],
  )

  const markedCount = currentProject?.nodes.filter((n) => n.data.isMarked).length ?? 0

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
      <div className="flex items-center justify-between border-b border-white/20 px-5 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'knowledgeGraph')}</div>
          <h1 className="font-display text-xl tracking-[-0.03em] text-cohere-black">{t(locale, 'wikiGraph')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-slate">
            {wikiGraph ? t(locale, 'pagesLinks', wikiGraph.pages.length, wikiGraph.links.length) : t(locale, 'loading')}
          </div>
          <button
            onClick={handleCompile}
            disabled={wikiCompiling || markedCount === 0}
            className={[
              'flex items-center gap-2 rounded-card px-4 py-2 text-sm font-semibold transition-all duration-200',
              wikiCompiling || markedCount === 0
                ? 'cursor-not-allowed bg-white/30 text-muted-slate'
                : 'bg-olive-accent text-white shadow-btn hover:shadow-btn-hover hover:bg-olive-accent/90',
            ].join(' ')}
          >
            {wikiCompiling ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
            {wikiCompiling ? t(locale, 'compiling2') : t(locale, 'compileWikiCount', markedCount)}
          </button>
        </div>
      </div>

      <div className="flex-1">
        {wikiGraph && wikiGraph.pages.length > 0 ? (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onRfNodesChange}
            onEdgesChange={onRfEdgesChange}
            nodeTypes={wikiGraphNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e5e7eb" gap={20} size={1} />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              nodeColor={() => '#6366f1'}
              maskColor="rgba(23,23,28,0.05)"
              style={{ borderRadius: 12 }}
            />
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-card border border-white/30 bg-white/65 px-8 py-7 text-center shadow-panel backdrop-blur-xl">
              <BookOpen size={32} className="mx-auto text-muted-slate" />
              <div className="mt-4 font-display text-[22px] tracking-[-0.03em] text-cohere-black">{t(locale, 'noWikiPagesYet')}</div>
              <div className="mt-2 text-sm leading-relaxed text-muted-slate">
                {t(locale, 'markAndCompile')}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedPage && (
        <WikiPageDetail
          page={selectedPage}
          onClose={() => setSelectedWikiPageId(null)}
          onDelete={() => {
            void deleteWikiPage(selectedPage.id)
            setSelectedWikiPageId(null)
          }}
          onJumpToNode={handleJumpToNode}
        />
      )}
    </div>
  )
}
