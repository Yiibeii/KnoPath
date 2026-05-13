import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Edit3, FileText, FolderOpen, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Star, StarOff, Trash2, X } from 'lucide-react'

import { getChildNodes, getRootNodes } from '../lib/tree'
import { searchNodes } from '../lib/search'
import { WORKSPACE_CHROME_LAYOUT } from '../lib/workspaceChromeLayout'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { SearchResult } from '../types'

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const getFieldLabels = (locale: string): Record<string, string> => ({
  question: t(locale, 'fieldQuestion'),
  answer: t(locale, 'fieldResponse'),
  summary: t(locale, 'fieldSummary'),
})

export default function LeftPanel() {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const {
    projects,
    currentProject,
    createProject,
    selectProject,
    removeProject,
    toggleProjectFavorite,
    leftPanelOpen,
    focusedNodeId,
    setFocusedNode,
    setSettingsOpen,
    toggleLeftPanel,
    updateProjectTitle,
    exploreSearchQuery,
    setExploreSearchQuery,
    setSearchHighlight,
  } = useStore()
  const [activeTab, setActiveTab] = useState<'projects' | 'outline'>('projects')
  const [projectFilter, setProjectFilter] = useState<'history' | 'favorites'>('history')
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const outline = useMemo(() => {
    if (!currentProject) return []

    const rows: Array<{ id: string; label: string; depth: number; isMarked: boolean }> = []
    const visit = (nodeId: string, depth: number) => {
      const node = currentProject.nodes.find((item) => item.id === nodeId)
      if (!node) return
      rows.push({ id: node.id, label: node.data.question || t(locale, 'untitledNode'), depth, isMarked: node.data.isMarked })
      for (const child of getChildNodes(node.id, currentProject)) {
        visit(child.id, depth + 1)
      }
    }

    for (const root of getRootNodes(currentProject)) {
      visit(root.id, 0)
    }

    return rows
  }, [currentProject, locale])

  const searchResults = useMemo(() => {
    if (!currentProject || !exploreSearchQuery.trim()) return []
    return searchNodes(currentProject, exploreSearchQuery)
  }, [currentProject, exploreSearchQuery])

  const toggleExpand = (id: string) => {
    setExpandedProjects((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectSearchResult = (result: SearchResult) => {
    setFocusedNode(result.nodeId)
    setSearchHighlight({ query: exploreSearchQuery.trim(), matchedField: result.matchedField })
  }

  const visibleProjects = projectFilter === 'favorites' ? projects.filter((project) => project.isFavorite) : projects

  if (!leftPanelOpen) {
    return (
      <aside className={WORKSPACE_CHROME_LAYOUT.insightCollapsedRailClassName}>
        <button
          onClick={toggleLeftPanel}
          className={WORKSPACE_CHROME_LAYOUT.iconButtonClassName}
          title={t(locale, 'openSidebar')}
        >
          <PanelLeftOpen size={16} />
        </button>

        <button
          onClick={() => void createProject()}
          className={[WORKSPACE_CHROME_LAYOUT.iconButtonClassName, 'mt-3'].join(' ')}
          title={t(locale, 'createNewProject')}
        >
          <Plus size={16} />
        </button>

        <div className="mt-4 flex w-full flex-1 items-start justify-center">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-slate [writing-mode:vertical-rl] [text-orientation:mixed]">
            {t(locale, 'workspace')}
          </div>
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className={WORKSPACE_CHROME_LAYOUT.iconButtonClassName}
          title={t(locale, 'settings')}
        >
          <Settings size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={WORKSPACE_CHROME_LAYOUT.librarySidebarClassName}>
      <div className="border-b border-white/20 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'workspace')}</div>
            <div className="mt-1 font-display text-xl tracking-[-0.03em] text-cohere-black">{t(locale, 'projects')}</div>
          </div>
          <button
            onClick={toggleLeftPanel}
            className={WORKSPACE_CHROME_LAYOUT.iconButtonClassName}
            title={t(locale, 'collapseSidebar')}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      <div className="flex border-b border-white/20">
        <button
          onClick={() => setActiveTab('projects')}
          className={[
            'flex-1 py-3 text-sm font-medium transition-colors',
            activeTab === 'projects' ? 'text-cohere-black border-b-2 border-olive-accent' : 'text-muted-slate hover:text-cohere-black',
          ].join(' ')}
        >
          {t(locale, 'projects')}
        </button>
        <button
          onClick={() => setActiveTab('outline')}
          className={[
            'flex-1 py-3 text-sm font-medium transition-colors',
            activeTab === 'outline' ? 'text-cohere-black border-b-2 border-olive-accent' : 'text-muted-slate hover:text-cohere-black',
          ].join(' ')}
        >
          {t(locale, 'outline')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {currentProject ? (
          <div className="relative flex items-center gap-2 rounded-card border border-white/30 bg-white/60 px-3 py-2 backdrop-blur-xl">
            <Search size={14} className="shrink-0 text-muted-slate" />
            <input
              value={exploreSearchQuery}
              onChange={(e) => {
                setExploreSearchQuery(e.target.value)
                if (!e.target.value.trim()) setSearchHighlight(null)
              }}
              placeholder={t(locale, 'searchNodes')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-slate/60"
            />
            {exploreSearchQuery ? (
              <button
                onClick={() => {
                  setExploreSearchQuery('')
                  setSearchHighlight(null)
                }}
                className="shrink-0 rounded-full p-0.5 text-muted-slate transition-colors hover:text-cohere-black"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        ) : null}

        {exploreSearchQuery.trim() && currentProject ? (
          <ExploreSearchResults
            results={searchResults}
            focusedNodeId={focusedNodeId}
            onSelectResult={handleSelectSearchResult}
            query={exploreSearchQuery.trim()}
          />
        ) : null}

        {!exploreSearchQuery.trim() && activeTab === 'projects' ? (
          <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
              <FolderOpen size={14} />
              {t(locale, 'projectList')}
            </div>
            <div className="mt-2 flex items-center gap-1 rounded-[14px] bg-white/40 p-1 border border-white/20">
              <button
                onClick={() => setProjectFilter('history')}
                className={[
                  'flex-1 rounded-[10px] px-3 py-1.5 text-xs transition-colors cursor-pointer',
                  projectFilter === 'history' ? 'bg-white/60 text-cohere-black' : 'text-muted-slate hover:text-cohere-black',
                ].join(' ')}
              >
                {t(locale, 'history')}
              </button>
              <button
                onClick={() => setProjectFilter('favorites')}
                className={[
                  'flex-1 rounded-[10px] px-3 py-1.5 text-xs transition-colors cursor-pointer',
                  projectFilter === 'favorites' ? 'bg-white/60 text-cohere-black' : 'text-muted-slate hover:text-cohere-black',
                ].join(' ')}
              >
                {t(locale, 'favorite')}
              </button>
            </div>

            <button
              onClick={() => void createProject()}
              className="mt-2 w-full flex items-center gap-2 rounded-[16px] px-3 py-2 text-sm text-muted-slate hover:text-cohere-black hover:bg-white/50 transition-colors"
            >
              <Plus size={16} />
              {t(locale, 'newProject')}
            </button>

            <div className="mt-2 space-y-1.5">
              {visibleProjects.map((project) => (
                <div key={project.id}>
                  <div
                    onClick={() => {
                      if (renamingProjectId !== project.id) {
                        void selectProject(project.id)
                      }
                    }}
                    onDoubleClick={() => {
                      setRenamingProjectId(project.id)
                      setRenameValue(project.title)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setContextMenu({ id: project.id, x: event.clientX, y: event.clientY })
                    }}
                    className={[
                      'group flex items-center gap-2 px-3 py-2 rounded-[16px] cursor-pointer transition-colors',
                      currentProject?.id === project.id ? 'bg-olive-accent/10 text-olive-accent' : 'text-cohere-black hover:bg-white/50',
                    ].join(' ')}
                  >
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleExpand(project.id)
                      }}
                      className="p-0.5"
                    >
                      {expandedProjects.has(project.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <FolderOpen size={16} />
                    <div className="min-w-0 flex-1">
                      {renamingProjectId === project.id ? (
                        <input
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={async (event) => {
                            if (event.key === 'Enter') {
                              const nextTitle = renameValue.trim()
                              if (nextTitle && nextTitle !== project.title) {
                                if (currentProject?.id !== project.id) {
                                  await selectProject(project.id)
                                }
                                await updateProjectTitle(nextTitle)
                              }
                              setRenamingProjectId(null)
                              setRenameValue('')
                            } else if (event.key === 'Escape') {
                              setRenamingProjectId(null)
                              setRenameValue('')
                            }
                          }}
                          onBlur={async () => {
                            const nextTitle = renameValue.trim()
                            if (nextTitle && nextTitle !== project.title) {
                              if (currentProject?.id !== project.id) {
                                await selectProject(project.id)
                              }
                              await updateProjectTitle(nextTitle)
                            }
                            setRenamingProjectId(null)
                            setRenameValue('')
                          }}
                          onClick={(event) => event.stopPropagation()}
                          className="w-full rounded border border-white/30 bg-white/50 px-1 py-0.5 text-sm text-cohere-black focus:outline-none focus:border-olive-accent"
                          autoFocus
                        />
                      ) : (
                        <>
                          <div className="truncate text-sm font-medium">{project.title}</div>
                          <div className="text-[11px] text-muted-slate">{formatUpdatedAt(project.updatedAt)}</div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        void toggleProjectFavorite(project.id)
                      }}
                      className="rounded-lg p-1 hover:bg-white/50 transition-colors cursor-pointer"
                      title={project.isFavorite ? t(locale, 'removeFromFavorites') : t(locale, 'addToFavorites')}
                    >
                      {project.isFavorite ? <Star size={14} className="text-amber-500 fill-amber-500" /> : <StarOff size={14} className="text-muted-slate" />}
                    </button>
                    <span className="text-xs text-muted-slate">{project.nodeCount}</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        void removeProject(project.id)
                      }}
                      className="shrink-0 rounded-lg p-1.5 text-muted-slate opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                      title={t(locale, 'deleteProject')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {expandedProjects.has(project.id) ? (
                    <div className="ml-6 mt-1 space-y-1">
                      {project.nodes.slice(0, 4).map((node) => (
                        <div key={node.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-slate rounded-[14px] cursor-default">
                          <FileText size={14} />
                          <span className="truncate">{node.data.question || t(locale, 'untitledNode')}</span>
                        </div>
                      ))}
                      {project.nodes.length > 4 ? <div className="px-3 py-1 text-xs text-muted-slate">{t(locale, 'moreNodes', project.nodes.length - 4)}</div> : null}
                    </div>
                  ) : null}
                </div>
              ))}

              {visibleProjects.length === 0 ? <div className="rounded-[16px] bg-white/40 px-3 py-4 text-sm text-muted-slate text-center">{projectFilter === 'favorites' ? t(locale, 'noFavoriteProjects') : t(locale, 'noProjectsYet')}</div> : null}
            </div>
          </section>
        ) : null}

        {!exploreSearchQuery.trim() && activeTab === 'outline' ? (
          <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
              <FileText size={14} />
              {t(locale, 'nodeOutline')}
            </div>
            {!currentProject ? (
              <div className="mt-3 rounded-[16px] bg-white/40 px-3 py-4 text-sm text-muted-slate text-center">{t(locale, 'selectProjectFirst')}</div>
            ) : outline.length === 0 ? (
              <div className="mt-3 rounded-[16px] bg-white/40 px-3 py-4 text-sm text-muted-slate text-center">{t(locale, 'noNodesYet')}</div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {outline.map((row) => (
                  <div
                    key={row.id}
                    onClick={() => setFocusedNode(row.id)}
                    className={[
                      'flex items-center gap-2 px-3 py-2 rounded-[16px] cursor-pointer transition-colors',
                      focusedNodeId === row.id ? 'bg-olive-accent/10 text-olive-accent' : 'text-cohere-black hover:bg-white/50',
                    ].join(' ')}
                    style={{ paddingLeft: `${12 + row.depth * 18}px` }}
                  >
                    <FileText size={14} />
                    <span className="text-sm truncate">{row.label}</span>
                    {row.isMarked ? <span className="w-2 h-2 rounded-full bg-olive-accent" /> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>

      <div className="border-t border-white/20 p-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-2 rounded-[16px] px-3 py-2 text-sm text-muted-slate hover:text-cohere-black hover:bg-white/50 transition-colors cursor-pointer"
        >
          <Settings size={16} />
          {t(locale, 'settings')}
        </button>
      </div>

      {contextMenu ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed rounded-[16px] border border-white/30 bg-white/75 p-2 shadow-menu backdrop-blur-xl z-50 min-w-[140px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              onClick={() => {
                const project = projects.find((item) => item.id === contextMenu.id)
                setRenamingProjectId(contextMenu.id)
                setRenameValue(project?.title ?? '')
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left text-sm text-near-black transition-all duration-200 hover:bg-olive-highlight"
            >
              <Edit3 size={14} />
              {t(locale, 'rename')}
            </button>
            <button
              onClick={() => {
                void removeProject(contextMenu.id)
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left text-sm text-red-500 transition-all duration-200 hover:bg-red-50"
            >
              <Trash2 size={14} />
              {t(locale, 'delete')}
            </button>
          </div>
        </>
      ) : null}
    </aside>
  )
}

interface ExploreSearchResultsProps {
  results: SearchResult[]
  focusedNodeId: string | null
  onSelectResult: (result: SearchResult) => void
  query: string
}

function ExploreSearchResults({ results, focusedNodeId, onSelectResult, query }: ExploreSearchResultsProps) {
  const currentProject = useStore((state) => state.currentProject)
  const locale = useStore((s) => s.settings.locale ?? 'zh')

  const resultsWithLabel = useMemo(() => {
    if (!currentProject) return []
    return results.map((result) => {
      const node = currentProject.nodes.find((n) => n.id === result.nodeId)
      return {
        ...result,
        question: node?.data.question || t(locale, 'untitledNode'),
      }
    })
  }, [results, currentProject, locale])

  const fieldLabels = getFieldLabels(locale)

  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
        <Search size={14} />
        {t(locale, 'searchResults')}
      </div>
      <div className="mt-1 text-[11px] text-muted-slate">
        {results.length > 0
          ? t(locale, 'matchFound', results.length)
          : t(locale, 'noResultsFor', query)}
      </div>
      <div className="mt-3 space-y-2">
        {resultsWithLabel.map((result) => (
          <div
            key={result.nodeId + result.matchedField}
            className={[
              'rounded-[14px] px-3 py-2.5 transition-colors cursor-pointer',
              focusedNodeId === result.nodeId ? 'bg-olive-accent/10' : 'bg-white/30 hover:bg-white/50',
            ].join(' ')}
            onClick={() => onSelectResult(result)}
          >
            <div className="flex items-center gap-2">
              <FileText size={12} className="shrink-0 text-muted-slate" />
              <span className="truncate text-sm font-medium text-cohere-black">{result.question}</span>
            </div>
            <div className="mt-1.5 pl-5 text-[12px] leading-snug">
              <span className="inline-block rounded-[4px] bg-olive-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-olive-accent">
                {fieldLabels[result.matchedField] ?? result.matchedField}
              </span>
              <span className="ml-1.5 text-muted-slate">
                {highlightMatchInPreview(result.preview, query)}
              </span>
            </div>
          </div>
        ))}
        {results.length === 0 && (
          <div className="rounded-[14px] bg-white/30 px-3 py-4 text-center text-sm text-muted-slate">
            {t(locale, 'tryDifferentKeywords')}
          </div>
        )}
      </div>
    </section>
  )
}

function highlightMatchInPreview(preview: string, query: string): React.ReactNode {
  const lowerPreview = preview.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lowerPreview.indexOf(lowerQuery)
  if (idx < 0) return preview

  const before = preview.slice(0, idx)
  const match = preview.slice(idx, idx + query.length)
  const after = preview.slice(idx + query.length)

  return (
    <>
      {before}
      <span className="rounded-[2px] bg-amber-200/80 px-0.5 text-cohere-black">{match}</span>
      {after}
    </>
  )
}
