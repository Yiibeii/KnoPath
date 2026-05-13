import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, BookOpen, X } from 'lucide-react'

import {
  wikiGraphNodeTypes,
  buildWikiGraphNodes,
  buildWikiGraphEdges,
} from '../lib/wikiGraphShared'
import { useStore } from '../store'
import { t } from '../lib/i18n'
import MarkdownContent from './MarkdownContent'

interface InsightGraphProps {
  onJumpToNode: (projectId: string, nodeId: string) => Promise<void>
  selectedProjectIds: Set<string>
}

export default function InsightGraph({ onJumpToNode, selectedProjectIds }: InsightGraphProps) {
  const {
    wikiGraph,
    selectedWikiPageId,
    setSelectedWikiPageId,
  } = useStore()
  const locale = useStore(s => s.settings.locale ?? 'zh')

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<RFNode>([])
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<RFEdge>([])

  const filteredWikiGraph = useMemo(() => {
    if (!wikiGraph) return { pages: [], links: [] }
    if (selectedProjectIds.size === 0) return wikiGraph

    const filteredPages = wikiGraph.pages.filter(
      (page) => page.sourceProjectId && selectedProjectIds.has(page.sourceProjectId)
    )
    const filteredPageIds = new Set(filteredPages.map((p) => p.id))
    const filteredLinks = wikiGraph.links.filter(
      (link) => filteredPageIds.has(link.sourcePageId) && filteredPageIds.has(link.targetPageId)
    )
    return { pages: filteredPages, links: filteredLinks }
  }, [wikiGraph, selectedProjectIds])

  const selectedWikiPage = useMemo(() => {
    if (!filteredWikiGraph || !selectedWikiPageId) return null
    return filteredWikiGraph.pages.find((page) => page.id === selectedWikiPageId) ?? null
  }, [filteredWikiGraph, selectedWikiPageId])

  const handleSelectPage = useCallback((pageId: string) => {
    setSelectedWikiPageId(pageId)
  }, [setSelectedWikiPageId])

  useEffect(() => {
    if (filteredWikiGraph) {
      const nodes = buildWikiGraphNodes(filteredWikiGraph.pages, selectedWikiPageId, handleSelectPage)
      const edges = buildWikiGraphEdges(filteredWikiGraph.links)
      setRfNodes(nodes)
      setRfEdges(edges)
    }
  }, [filteredWikiGraph, selectedWikiPageId, handleSelectPage, setRfNodes, setRfEdges])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="absolute right-4 top-4 z-10">
        <div className="text-sm text-muted-slate">
          {filteredWikiGraph ? t(locale, 'pagesLinks', filteredWikiGraph.pages.length, filteredWikiGraph.links.length) : ''}
        </div>
      </div>
      <div className="flex-1">
        {filteredWikiGraph && filteredWikiGraph.pages.length > 0 ? (
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
              <div className="mt-4 font-display text-[22px] tracking-[-0.03em] text-cohere-black">{t(locale, 'noWikiEntriesYet')}</div>
              <div className="mt-2 text-sm leading-relaxed text-muted-slate">
                {t(locale, 'markAndInsight')}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedWikiPage && (
        <div className="absolute bottom-4 right-4 z-10 w-[380px] max-h-[80vh] overflow-y-auto rounded-card border border-white/30 bg-white/65 p-5 shadow-panel backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'wikiPage')}</div>
              <h2 className="mt-1 font-display text-xl tracking-[-0.03em] text-cohere-black">{selectedWikiPage.title}</h2>
            </div>
            <button onClick={() => setSelectedWikiPageId(null)} className="shrink-0 rounded-full p-1 text-muted-slate transition-colors hover:bg-white/50 hover:text-cohere-black">
              <X size={16} />
            </button>
          </div>

          {selectedWikiPage.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedWikiPage.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-olive-accent/10 px-2.5 py-1 text-[11px] font-medium text-olive-accent">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 text-xs text-muted-slate">
            <span className={`rounded-full px-2 py-0.5 ${selectedWikiPage.status === 'draft' ? 'bg-amber-100 text-amber-700' : selectedWikiPage.status === 'review' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {selectedWikiPage.status}
            </span>
            <span className={`rounded-full px-2 py-0.5 ${selectedWikiPage.sensitivity === 'public' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
              {selectedWikiPage.sensitivity}
            </span>
          </div>

          {selectedWikiPage.summary && (
            <div className="mt-4 rounded-card bg-white/40 p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'summaryLabel')}</div>
              <div className="mt-2">
                <MarkdownContent content={selectedWikiPage.summary} className="text-sm leading-relaxed text-near-black" />
              </div>
            </div>
          )}

          {selectedWikiPage.content && (
            <div className="mt-4 rounded-card bg-white/40 p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'coreContent')}</div>
              <div className="mt-2">
                <MarkdownContent content={selectedWikiPage.content} className="text-sm leading-relaxed text-near-black" />
              </div>
            </div>
          )}

          {selectedWikiPage.sourceReferences.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'sourceReferencesLabel')}</div>
              <div className="mt-2 space-y-1">
                {selectedWikiPage.sourceReferences.map((ref, index) => (
                  <div key={index} className="text-xs text-olive-accent font-mono">{ref}</div>
                ))}
              </div>
            </div>
          )}

          {selectedWikiPage.relatedTopics.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'relatedPages')}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedWikiPage.relatedTopics.map((topic) => (
                  <span key={topic} className="rounded-full bg-white/40 px-2.5 py-1 text-xs text-near-black border border-white/25">
                    [[{topic}]]
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectedWikiPage.questions.length > 0 && (
            <div className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-amber-700">{t(locale, 'questionsGaps')}</div>
              <ul className="mt-2 space-y-1">
                {selectedWikiPage.questions.map((q, index) => (
                  <li key={index} className="text-xs text-amber-800">• {q}</li>
                ))}
              </ul>
            </div>
          )}

          {selectedWikiPage.sourceProjectId && selectedWikiPage.sourceNodeId && (
            <button
              onClick={() => void onJumpToNode(selectedWikiPage.sourceProjectId!, selectedWikiPage.sourceNodeId!)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-olive-accent px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 shadow-btn hover:shadow-btn-hover hover:bg-olive-accent/90"
            >
              <ArrowRight size={14} />
              {t(locale, 'jumpToSourceNode')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
