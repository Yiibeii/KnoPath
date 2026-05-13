import React, { useMemo, useState } from 'react'
import { BookOpenText, Check, ChevronDown, FileCode2, FolderGit2, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Trash2, X } from 'lucide-react'

import { t } from '../lib/i18n'
import { WORKSPACE_CHROME_LAYOUT } from '../lib/workspaceChromeLayout'
import { formatTime } from '../lib/insightUtils'
import { searchWikiPages } from '../lib/search'
import { useStore } from '../store'
import WikiLint from './WikiLint'
import WikiLogs from './WikiLogs'
import type { Project, WikiPage, WikiSearchResult } from '../types'

interface WikiEntry {
  page: WikiPage
  project: Project | null
}

interface InsightLeftPanelProps {
  selectedPageId: string | null
  onSelectWikiPage: (pageId: string) => void
  onSelectRawEntry: (nodeId: string) => void
  wikiSearchQuery: string
  setWikiSearchQuery: (query: string) => void
  selectedProjectIds: Set<string>
  onToggleProjectFilter: (projectId: string) => void
}

function getFieldLabels(locale: string): Record<string, string> {
  return {
    title: t(locale, 'fieldTitle'),
    content: t(locale, 'fieldContent'),
    summary: t(locale, 'fieldSummary'),
    tags: t(locale, 'fieldTags'),
    relatedTopics: t(locale, 'fieldRelated'),
  }
}

export default function InsightLeftPanel({ selectedPageId, onSelectWikiPage, onSelectRawEntry, wikiSearchQuery, setWikiSearchQuery, selectedProjectIds, onToggleProjectFilter }: InsightLeftPanelProps) {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const projects = useStore((state) => state.projects)
  const insightLeftPanelOpen = useStore((state) => state.insightLeftPanelOpen)
  const toggleInsightLeftPanel = useStore((state) => state.toggleInsightLeftPanel)
  const wikiGraph = useStore((state) => state.wikiGraph)
  const [projectFiltersOpen, setProjectFiltersOpen] = useState(false)
  const [rawDataOpen, setRawDataOpen] = useState(false)

  const allWikiEntries = useMemo<WikiEntry[]>(() => {
    if (!wikiGraph.pages) return []
    
    return wikiGraph.pages
      .map((page) => ({
        page,
        project: projects.find((p) => p.id === page.sourceProjectId) ?? null,
      }))
      .sort((left, right) => {
        const rightTime = right.page.updatedAt ?? right.page.compiledAt ?? ''
        const leftTime = left.page.updatedAt ?? left.page.compiledAt ?? ''
        return rightTime.localeCompare(leftTime)
      })
  }, [wikiGraph.pages, projects])

  const projectLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of projects) {
      map.set(project.id, project.title)
    }
    return map
  }, [projects])

  const wikiSearchResults = useMemo(() => {
    if (!wikiSearchQuery.trim() || !wikiGraph.pages) return []
    return searchWikiPages(wikiGraph.pages, projectLookup, wikiSearchQuery)
  }, [wikiSearchQuery, wikiGraph.pages, projectLookup])

  const filteredWikiEntries = useMemo(() => {
    let entries = allWikiEntries
    if (selectedProjectIds.size > 0) {
      entries = entries.filter((entry) => entry.project && selectedProjectIds.has(entry.project.id))
    }
    return entries
  }, [allWikiEntries, selectedProjectIds])

  const clearProjectFilters = () => {
    // Clear all filters by toggling each selected project
    selectedProjectIds.forEach((id) => onToggleProjectFilter(id))
  }

  if (!insightLeftPanelOpen) {
    return (
      <aside className={WORKSPACE_CHROME_LAYOUT.insightCollapsedRailClassName}>
        <button
          onClick={toggleInsightLeftPanel}
          className={WORKSPACE_CHROME_LAYOUT.iconButtonClassName}
          title={t(locale, 'openInsightSidebar')}
        >
          <PanelLeftOpen size={16} />
        </button>

        <div className="mt-4 flex w-full flex-1 items-start justify-center">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-slate [writing-mode:vertical-rl] [text-orientation:mixed]">
            {t(locale, 'insightSidebarLabel')}
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className={WORKSPACE_CHROME_LAYOUT.librarySidebarClassName}>
      <div className="border-b border-white/20 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'repositoryKnowledge')}</div>
            <div className="mt-1 font-display text-xl tracking-[-0.03em] text-cohere-black">{t(locale, 'library')}</div>
          </div>
          <button
            onClick={toggleInsightLeftPanel}
            className={WORKSPACE_CHROME_LAYOUT.iconButtonClassName}
            title={t(locale, 'collapseInsightSidebar')}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="relative flex items-center gap-2 rounded-card border border-white/30 bg-white/60 px-3 py-2 backdrop-blur-xl">
          <Search size={14} className="shrink-0 text-muted-slate" />
          <input
            value={wikiSearchQuery}
            onChange={(e) => setWikiSearchQuery(e.target.value)}
            placeholder={t(locale, 'searchWikiContent')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-slate/60"
          />
          {wikiSearchQuery ? (
            <button
              onClick={() => setWikiSearchQuery('')}
              className="shrink-0 rounded-full p-0.5 text-muted-slate transition-colors hover:text-cohere-black"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {wikiSearchQuery.trim() ? (
          <WikiSearchResultsSection
            results={wikiSearchResults}
            selectedPageId={selectedPageId}
            onSelectWikiPage={onSelectWikiPage}
            query={wikiSearchQuery.trim()}
            locale={locale}
          />
        ) : (
          <>
            <ProjectFiltersSection
              projects={projects}
              selectedProjectIds={selectedProjectIds}
              projectFiltersOpen={projectFiltersOpen}
              setProjectFiltersOpen={setProjectFiltersOpen}
              toggleProjectFilter={onToggleProjectFilter}
              clearProjectFilters={clearProjectFilters}
              allWikiEntries={allWikiEntries}
              locale={locale}
            />

            <AllWikiSection
              filteredWikiEntries={filteredWikiEntries}
              selectedProjectIds={selectedProjectIds}
              allWikiEntries={allWikiEntries}
              selectedPageId={selectedPageId}
              onSelectWikiPage={onSelectWikiPage}
              locale={locale}
            />

            <RawDataSection
              projects={projects}
              selectedProjectIds={selectedProjectIds}
              rawDataOpen={rawDataOpen}
              setRawDataOpen={setRawDataOpen}
              onSelectRawEntry={onSelectRawEntry}
              locale={locale}
            />

            <WikiDiagnosticsSection onSelectWikiPage={onSelectWikiPage} locale={locale} />
          </>
        )}
      </div>
    </aside>
  )
}

function WikiDiagnosticsSection({ onSelectWikiPage, locale }: { onSelectWikiPage: (pageId: string) => void; locale: string }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/45 p-3 backdrop-blur-xl">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] px-1 py-1 text-left transition-colors hover:text-cohere-black"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <ShieldCheck size={14} />
            {t(locale, 'wikiDiagnostics')}
          </div>
          <div className="mt-2 text-sm text-cohere-black">
            {t(locale, 'wikiDiagnosticsDesc')}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={['shrink-0 text-muted-slate transition-transform', open ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <WikiLint onSelectWikiPage={onSelectWikiPage} />
          <WikiLogs />
        </div>
      )}
    </section>
  )
}

interface WikiSearchResultsSectionProps {
  results: WikiSearchResult[]
  selectedPageId: string | null
  onSelectWikiPage: (pageId: string) => void
  query: string
  locale: string
}

function WikiSearchResultsSection({ results, selectedPageId, onSelectWikiPage, query, locale }: WikiSearchResultsSectionProps) {
  const fieldLabels = getFieldLabels(locale)
  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
        <Search size={14} />
        {t(locale, 'searchResults')}
      </div>
      <div className="mt-1 text-[11px] text-muted-slate">
        {results.length > 0
          ? t(locale, 'matchInPages', results.reduce((sum, r) => sum + r.matches.length, 0), results.length)
          : t(locale, 'noResultsForQuery', query)}
      </div>
      <div className="mt-3 space-y-2">
        {results.map((result) => (
          <div
            key={result.pageId}
            className={[
              'rounded-[14px] px-3 py-2.5 transition-colors cursor-pointer',
              selectedPageId === result.pageId ? 'bg-olive-accent/10' : 'bg-white/30 hover:bg-white/50',
            ].join(' ')}
            onClick={() => onSelectWikiPage(result.pageId)}
          >
            <div className="flex items-center gap-2">
              <BookOpenText size={12} className="shrink-0 text-muted-slate" />
              <span className="truncate text-sm font-medium text-cohere-black">{result.pageTitle}</span>
            </div>
            {result.projectTitle && (
              <div className="mt-1 truncate pl-5 text-[11px] text-muted-slate">{result.projectTitle}</div>
            )}
            <div className="mt-1.5 space-y-1 pl-5">
              {result.matches.map((match, matchIndex) => (
                <div key={matchIndex} className="text-[12px] leading-snug">
                  <span className="inline-block rounded-[4px] bg-olive-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-olive-accent">
                    {fieldLabels[match.field] ?? match.field}
                  </span>
                  <span className="ml-1.5 text-muted-slate">
                    {highlightMatchInPreview(match.preview, query)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {results.length === 0 && (
          <div className="rounded-[14px] bg-white/30 px-3 py-4 text-center text-sm text-muted-slate">
            {t(locale, 'tryDifferentKeywordsOrClear')}
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

interface ProjectFiltersSectionProps {
  projects: Project[]
  selectedProjectIds: Set<string>
  projectFiltersOpen: boolean
  setProjectFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggleProjectFilter: (projectId: string) => void
  clearProjectFilters: () => void
  allWikiEntries: WikiEntry[]
  locale: string
}

function ProjectFiltersSection({
  projects,
  selectedProjectIds,
  projectFiltersOpen,
  setProjectFiltersOpen,
  toggleProjectFilter,
  clearProjectFilters,
  allWikiEntries,
  locale,
}: ProjectFiltersSectionProps) {
  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <button
        onClick={() => setProjectFiltersOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] px-1 py-1 text-left transition-colors hover:text-cohere-black"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <FolderGit2 size={14} />
            {t(locale, 'projectFilters')}
          </div>
          <div className="mt-2 text-sm text-cohere-black">
            {selectedProjectIds.size > 0
              ? t(locale, 'projectsSelected', selectedProjectIds.size)
              : t(locale, 'allProjects')}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={['shrink-0 text-muted-slate transition-transform', projectFiltersOpen ? 'rotate-180' : ''].join(' ')}
        />
      </button>
      {projectFiltersOpen ? (
        <div className="mt-3 space-y-1.5">
          {selectedProjectIds.size > 0 ? (
            <button
              onClick={clearProjectFilters}
              className="w-full rounded-[14px] bg-white/40 px-3 py-2 text-left text-[11px] uppercase tracking-[0.18em] text-muted-slate transition-colors hover:text-cohere-black"
            >
              {t(locale, 'clearAllFilters')}
            </button>
          ) : null}
          {projects.map((project) => {
            const isSelected = selectedProjectIds.has(project.id)
            const projectWikiCount = allWikiEntries.filter((entry) => entry.project?.id === project.id).length

            return (
              <button
                key={project.id}
                onClick={() => toggleProjectFilter(project.id)}
                className={[
                  'flex w-full items-center justify-between rounded-[16px] px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-olive-accent/10 text-olive-accent' : 'text-cohere-black hover:bg-white/50',
                ].join(' ')}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{project.title}</div>
                  <div className="mt-1 text-[11px] text-muted-slate">{t(locale, 'wikiPagesCount', projectWikiCount)}</div>
                </div>
                <div
                  className={[
                    'ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                    isSelected ? 'border-olive-accent bg-olive-accent text-white' : 'border-white/40 text-transparent',
                  ].join(' ')}
                >
                  <Check size={12} />
                </div>
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

interface AllWikiSectionProps {
  filteredWikiEntries: WikiEntry[]
  selectedProjectIds: Set<string>
  allWikiEntries: WikiEntry[]
  selectedPageId: string | null
  onSelectWikiPage: (pageId: string) => void
  locale: string
}

function AllWikiSection({
  filteredWikiEntries,
  selectedProjectIds,
  allWikiEntries,
  selectedPageId,
  onSelectWikiPage,
  locale,
}: AllWikiSectionProps) {
  const deleteWikiPage = useStore((state) => state.deleteWikiPage)
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null)

  const handleDeleteWiki = async (e: React.MouseEvent, pageId: string) => {
    e.stopPropagation()
    if (deletingPageId) return
    
    setDeletingPageId(pageId)
    try {
      await deleteWikiPage(pageId)
    } finally {
      setDeletingPageId(null)
    }
  }

  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
        <BookOpenText size={14} />
        {t(locale, 'allWiki')}
      </div>
      <div className="mt-2 text-[11px] text-muted-slate">
        {selectedProjectIds.size > 0
          ? t(locale, 'pagesFromProjects', filteredWikiEntries.length, selectedProjectIds.size)
          : t(locale, 'pagesAcrossRepo', allWikiEntries.length)}
      </div>
      <div className="mt-3 space-y-1.5">
        {filteredWikiEntries.length > 0 ? (
          filteredWikiEntries.map((entry) => (
            <div
              key={`wiki-${entry.page.id}`}
              className={[
                'group flex items-center gap-2 rounded-[16px] px-3 py-2 transition-colors cursor-pointer',
                selectedPageId === entry.page.id ? 'bg-olive-accent/10 text-olive-accent' : 'text-cohere-black hover:bg-white/50',
              ].join(' ')}
              onClick={() => onSelectWikiPage(entry.page.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {entry.page.title || t(locale, 'untitledWikiPage')}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-slate">{entry.project?.title ?? t(locale, 'unknownProject')}</div>
                <div className="mt-1 text-[11px] text-muted-slate">{t(locale, 'compiled')} {formatTime(entry.page.updatedAt ?? entry.page.compiledAt ?? undefined)}</div>
              </div>
              <button
                onClick={(e) => handleDeleteWiki(e, entry.page.id)}
                disabled={deletingPageId === entry.page.id}
                className="shrink-0 rounded-lg p-1.5 text-muted-slate opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-50"
                title={t(locale, 'deleteWikiPage')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="rounded-[16px] bg-white/40 px-3 py-4 text-sm text-muted-slate">
            {t(locale, 'noWikiPagesMatch')}
          </div>
        )}
      </div>
    </section>
  )
}

interface RawDataSectionProps {
  projects: Project[]
  selectedProjectIds: Set<string>
  rawDataOpen: boolean
  setRawDataOpen: React.Dispatch<React.SetStateAction<boolean>>
  onSelectRawEntry: (nodeId: string) => void
  locale: string
}

function RawDataSection({ projects, selectedProjectIds, rawDataOpen, setRawDataOpen, onSelectRawEntry, locale }: RawDataSectionProps) {
  const markedNodes = useMemo(() => {
    let nodes = projects.flatMap((project) =>
      project.nodes
        .filter((node) => node.data.isMarked)
        .map((node) => ({ project, node }))
    )
    if (selectedProjectIds.size > 0) {
      nodes = nodes.filter((entry) => selectedProjectIds.has(entry.project.id))
    }
    return nodes
  }, [projects, selectedProjectIds])

  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <button
        onClick={() => setRawDataOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] px-1 py-1 text-left transition-colors hover:text-cohere-black"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <FileCode2 size={14} />
            {t(locale, 'rawData')}
          </div>
          <div className="mt-2 text-sm text-cohere-black">
            {t(locale, 'markedNodesCount', markedNodes.length)}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={['shrink-0 text-muted-slate transition-transform', rawDataOpen ? 'rotate-180' : ''].join(' ')}
        />
      </button>
      {rawDataOpen ? (
        <div className="mt-3 space-y-1.5">
          {markedNodes.slice(0, 10).map((entry) => (
            <button
              key={`raw-${entry.project.id}-${entry.node.id}`}
              onClick={() => onSelectRawEntry(entry.node.id)}
              className="w-full rounded-[16px] px-3 py-2 text-left text-sm text-muted-slate transition-colors hover:bg-white/50"
            >
              <div className="truncate">{entry.node.data.summary || entry.node.data.question || t(locale, 'untitledRawEntry')}</div>
              <div className="mt-1 truncate text-[11px]">{entry.project.title}</div>
            </button>
          ))}
          {markedNodes.length === 0 ? (
            <div className="rounded-[16px] bg-white/40 px-3 py-4 text-sm text-muted-slate">
              {t(locale, 'noMarkedNodes')}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
