import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenText, RefreshCw } from 'lucide-react'

import InsightLeftPanel from './InsightLeftPanel'
import InsightDetailView from './InsightDetailView'
import InsightSourceLinks from './InsightSourceLinks'
import InsightTemplates, { type TemplateKey } from './InsightTemplates'
import InsightGraph from './InsightGraph'
import { buildBranchPath, type InsightEntry } from '../lib/insightUtils'
import { shouldExitTemplatesOnLibrarySelection } from '../lib/insightLibrarySelection'
import { buildInsightOutline } from '../lib/insightOutline'
import { buildTemplateOutline } from '../lib/insightTemplateView'
import { resolveInsightMainPanelMode, type InsightMainPanelMode } from '../lib/insightViewState'
import { WORKSPACE_CHROME_LAYOUT } from '../lib/workspaceChromeLayout'
import { searchWikiPages } from '../lib/search'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { WikiPage } from '../types'
import type { InsightOutlineItem } from '../lib/insightOutline'

export default function InsightWorkspace() {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const {
    projects,
    currentProject,
    settings,
    selectProject,
    setFocusedNode,
    setWorkspace,
    updateKnowledgeBaseTemplates,
    insightTemplatesOpen,
    insightGraphOpen,
    insightOutlineOpen,
    insightLinksOpen,
    setInsightTemplatesOpen,
    toggleInsightGraph,
    loadWikiGraph,
    wikiGraph,
    insightSyncing,
    insightSyncProgress,
    insightSearchQuery,
    setInsightSearchQuery,
    cancelInsightSync,
  } = useStore()

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'wiki' | 'raw'>('wiki')
  const [activeTemplateKey, setActiveTemplateKey] = useState<TemplateKey>('readme')
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())

  const toggleProjectFilter = useCallback((projectId: string) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  const selectedPage = useMemo<WikiPage | null>(() => {
    if (!selectedPageId || !wikiGraph.pages) return null
    return wikiGraph.pages.find((p) => p.id === selectedPageId) ?? null
  }, [selectedPageId, wikiGraph.pages])

  const selectedEntry = useMemo<InsightEntry | null>(() => {
    if (!selectedPage) return null
    const project = projects.find((p) => p.id === selectedPage.sourceProjectId)
    if (!project) return null
    const node = project.nodes.find((n) => n.id === selectedPage.sourceNodeId)
    if (!node) return null
    return { project, node }
  }, [selectedPage, projects])

  const branchPath = selectedEntry ? buildBranchPath(selectedEntry.node, selectedEntry.project.nodes) : ''
  const mainPanelMode = resolveInsightMainPanelMode({ templatesOpen: insightTemplatesOpen, graphOpen: insightGraphOpen })

  const outlineItems = useMemo(() => {
    if (mainPanelMode === 'templates') {
      return buildTemplateOutline()
    }
    const displayTitle = selectedPage?.title || selectedEntry?.node.data.summary || selectedEntry?.node.data.question || t(locale, 'untitled')
    return buildInsightOutline(displayTitle, selectedPage?.content || selectedEntry?.node.data.answer || '')
  }, [selectedPage, selectedEntry, mainPanelMode])

  const headingPrefix = selectedPage ? `insight-${selectedPage.id}` : 'insight'

  useEffect(() => {
    if (!wikiGraph.pages || wikiGraph.pages.length === 0) {
      setSelectedPageId(null)
      return
    }

    if (!selectedPageId || !wikiGraph.pages.some((p) => p.id === selectedPageId)) {
      setSelectedPageId(wikiGraph.pages[0].id)
    }
  }, [wikiGraph.pages, selectedPageId])

  useEffect(() => {
    if (!insightSearchQuery.trim() || !wikiGraph.pages || wikiGraph.pages.length === 0) return
    const projectLookup = new Map(projects.map((p) => [p.id, p.title]))
    const results = searchWikiPages(wikiGraph.pages, projectLookup, insightSearchQuery)
    if (results.length > 0 && (!selectedPageId || !results.some((r) => r.pageId === selectedPageId))) {
      setSelectedPageId(results[0].pageId)
    }
  }, [insightSearchQuery, wikiGraph.pages, selectedPageId, projects])

  const handleSelectWikiPage = useCallback((pageId: string) => {
    setSelectedPageId(pageId)
    setViewMode('wiki')
    if (shouldExitTemplatesOnLibrarySelection(insightTemplatesOpen)) {
      setInsightTemplatesOpen(false)
    }
    if (insightGraphOpen) {
      toggleInsightGraph()
    }
  }, [insightTemplatesOpen, insightGraphOpen, setInsightTemplatesOpen, toggleInsightGraph])

  const handleSelectRawEntry = useCallback((nodeId: string) => {
    const page = wikiGraph.pages.find((p) => p.sourceNodeId === nodeId)
    if (page) {
      setSelectedPageId(page.id)
    }
    setViewMode('raw')
    if (shouldExitTemplatesOnLibrarySelection(insightTemplatesOpen)) {
      setInsightTemplatesOpen(false)
    }
    if (insightGraphOpen) {
      toggleInsightGraph()
    }
  }, [wikiGraph.pages, insightTemplatesOpen, insightGraphOpen, setInsightTemplatesOpen, toggleInsightGraph])

  const handleUpdateTemplate = useCallback(async (key: TemplateKey, value: string) => {
    await updateKnowledgeBaseTemplates({ ...settings.knowledgeBase.templates, [key]: value })
  }, [settings.knowledgeBase.templates, updateKnowledgeBaseTemplates])

  const handleJumpToNode = useCallback(async (projectId: string, nodeId: string) => {
    try {
      if (currentProject?.id !== projectId) {
        await selectProject(projectId)
      }
    } catch {
      // Even if project load fails, still attempt navigation
    }
    setFocusedNode(nodeId)
    setWorkspace('explore')
  }, [currentProject, selectProject, setFocusedNode, setWorkspace])

  useEffect(() => {
    void loadWikiGraph()
  }, [loadWikiGraph])

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas-bg">
        <div className="rounded-card border border-white/30 bg-white/65 px-8 py-7 text-center shadow-[0_24px_60px_rgba(23,23,28,0.08)] backdrop-blur-xl">
          <BookOpenText size={32} className="mx-auto text-muted-slate" />
          <div className="mt-4 font-display text-[28px] tracking-[-0.03em] text-cohere-black">{t(locale, 'noProjectsYet2')}</div>
          <div className="mt-2 max-w-md text-sm leading-relaxed text-muted-slate">
            {t(locale, 'createProjectForInsight')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 overflow-hidden" style={{
      background: [
        'radial-gradient(ellipse 70% 50% at 15% 25%, var(--canvas-glow-olive) 0%, transparent 60%)',
        'radial-gradient(ellipse 55% 45% at 85% 75%, var(--canvas-glow-blue) 0%, transparent 55%)',
        'radial-gradient(ellipse 50% 40% at 50% 90%, var(--canvas-glow-warm) 0%, transparent 50%)',
        'radial-gradient(ellipse 120% 100% at 50% 50%, var(--canvas-bg) 0%, var(--canvas-bg-deep) 100%)',
      ].join(', '),
    }}>
      <InsightLeftPanel
        selectedPageId={selectedPageId}
        onSelectWikiPage={handleSelectWikiPage}
        onSelectRawEntry={handleSelectRawEntry}
        wikiSearchQuery={insightSearchQuery}
        setWikiSearchQuery={setInsightSearchQuery}
        selectedProjectIds={selectedProjectIds}
        onToggleProjectFilter={toggleProjectFilter}
      />

      {(insightOutlineOpen || insightTemplatesOpen) && !insightGraphOpen ? (
        <aside className={WORKSPACE_CHROME_LAYOUT.insightUtilityRailClassName}>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <OutlineSection
              mainPanelMode={mainPanelMode}
              outlineItems={outlineItems}
              selectedEntry={selectedEntry}
              activeTemplateKey={activeTemplateKey}
              setActiveTemplateKey={setActiveTemplateKey}
              locale={locale}
            />
          </div>
        </aside>
      ) : null}

      <main className={mainPanelMode === 'graph' ? 'min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1 overflow-y-auto px-6 py-6'}>
        {mainPanelMode === 'graph' ? (
          <InsightGraph onJumpToNode={handleJumpToNode} selectedProjectIds={selectedProjectIds} />
        ) : mainPanelMode === 'templates' ? (
          <InsightTemplates
            settings={settings}
            activeTemplateKey={activeTemplateKey}
            onUpdateTemplate={handleUpdateTemplate}
          />
        ) : selectedPage ? (
          <InsightDetailView
            selectedEntry={selectedEntry}
            selectedPage={selectedPage}
            viewMode={viewMode}
            headingPrefix={headingPrefix}
            outlineItems={outlineItems}
            highlightQuery={insightSearchQuery.trim() || undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-card border border-white/30 bg-white/65 px-8 py-7 text-center shadow-[0_24px_60px_rgba(23,23,28,0.08)] backdrop-blur-xl">
              <div className="font-display text-[28px] tracking-[-0.03em] text-cohere-black">{t(locale, 'noInsightYet')}</div>
              <div className="mt-2 max-w-md text-sm leading-relaxed text-muted-slate">
                {t(locale, 'insightLibraryDesc')}
              </div>
            </div>
          </div>
        )}
      </main>

      <InsightSourceLinks
        selectedEntry={selectedEntry}
        branchPath={branchPath}
        insightLinksOpen={insightLinksOpen}
        insightGraphOpen={insightGraphOpen}
        selectedProjectIds={selectedProjectIds}
        projects={projects}
        onToggleProjectFilter={toggleProjectFilter}
      />

      {insightSyncProgress ? (
        <div
          onClick={insightSyncing ? cancelInsightSync : undefined}
          className={[
            'absolute bottom-5 left-1/2 z-30 max-w-[90vw] -translate-x-1/2 rounded-pill border border-white/30 bg-white/70 px-5 py-2.5 text-sm font-medium text-near-black shadow-menu backdrop-blur-xl',
            insightSyncing ? 'cursor-pointer hover:bg-white/90' : '',
          ].join(' ')}
        >
          <div className="flex items-center gap-3">
            <span className="truncate">
              {insightSyncing && <RefreshCw size={12} className="mr-2 inline animate-spin" />}
              {insightSyncProgress}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface OutlineSectionProps {
  mainPanelMode: InsightMainPanelMode
  outlineItems: InsightOutlineItem[]
  selectedEntry: InsightEntry | null
  activeTemplateKey: TemplateKey
  setActiveTemplateKey: (key: TemplateKey) => void
  locale: string
}

function OutlineSection({
  mainPanelMode,
  outlineItems,
  selectedEntry,
  activeTemplateKey,
  setActiveTemplateKey,
  locale,
}: OutlineSectionProps) {
  const jumpToOutlineItem = (id: string) => {
    const element = document.getElementById(`insight-${id}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
        <BookOpenText size={14} />
        {mainPanelMode === 'templates' ? t(locale, 'templateOutline') : t(locale, 'currentOutline')}
      </div>
      <div className="mt-2 text-xs text-muted-slate">
        {mainPanelMode === 'templates'
          ? t(locale, 'clickToNavigateTemplates')
          : t(locale, 'generatedFromInsight')}
      </div>
      <div className="mt-4 space-y-1">
        {mainPanelMode === 'templates' ? (
          outlineItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTemplateKey(item.id as TemplateKey)
                jumpToOutlineItem(item.id)
              }}
              className={[
                'block w-full rounded-[14px] px-3 py-2 text-left text-sm transition-colors hover:bg-white/50',
                activeTemplateKey === item.id ? 'bg-olive-accent/10 text-olive-accent' : 'text-cohere-black',
              ].join(' ')}
              style={{ paddingLeft: `${12 + Math.max(item.level - 1, 0) * 16}px` }}
            >
              {item.title}
            </button>
          ))
        ) : selectedEntry ? (
          outlineItems.map((item) => (
            <button
              key={item.id}
              onClick={() => jumpToOutlineItem(item.id)}
              className="block w-full rounded-[14px] px-3 py-2 text-left text-sm text-cohere-black transition-colors hover:bg-white/50"
              style={{ paddingLeft: `${12 + Math.max(item.level - 1, 0) * 16}px` }}
            >
              {item.title}
            </button>
          ))
        ) : (
          <div className="rounded-[16px] bg-white/40 px-3 py-4 text-sm text-muted-slate">
            {t(locale, 'selectWikiForOutline')}
          </div>
        )}
      </div>
    </section>
  )
}
