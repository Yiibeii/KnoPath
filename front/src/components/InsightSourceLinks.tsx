import { ArrowRight, BookOpenText, FolderGit2, Link2, X } from 'lucide-react'

import { formatTime, type InsightEntry } from '../lib/insightUtils'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { Project } from '../types'

interface InsightSourceLinksProps {
  selectedEntry: InsightEntry | null
  branchPath: string
  insightLinksOpen: boolean
  insightGraphOpen: boolean
  selectedProjectIds: Set<string>
  projects: Project[]
  onToggleProjectFilter: (projectId: string) => void
}

export default function InsightSourceLinks({
  selectedEntry,
  branchPath,
  insightLinksOpen,
  insightGraphOpen,
  selectedProjectIds,
  projects,
  onToggleProjectFilter,
}: InsightSourceLinksProps) {
  const { currentProject, selectProject, setFocusedNode, setWorkspace } = useStore()
  const locale = useStore(s => s.settings.locale ?? 'zh')

  if (!insightLinksOpen || insightGraphOpen) {
    return null
  }

  return (
    <aside className="flex w-[320px] flex-col border-l border-white/30 bg-white/55 backdrop-blur-xl">
      <div className="border-b border-white/20 px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'sourceLinksTitle')}</div>
        <div className="mt-1 font-display text-xl tracking-[-0.03em] text-cohere-black">{t(locale, 'connections')}</div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <FolderGit2 size={14} />
            {t(locale, 'sourceProject')}
          </div>
          <div className="mt-3 text-sm text-near-black">
            {selectedEntry ? selectedEntry.project.title : t(locale, 'selectWikiEntry')}
          </div>
          <div className="mt-1 text-xs leading-relaxed text-muted-slate">
            {selectedEntry
              ? t(locale, 'compiledFromProject', formatTime(selectedEntry.project.updatedAt))
              : t(locale, 'chooseEntryToInspect')}
          </div>
        </section>

        <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <Link2 size={14} />
            {t(locale, 'sourceNode')}
          </div>
          <div className="mt-3 text-sm text-near-black">
            {selectedEntry ? selectedEntry.node.data.question || t(locale, 'untitledNode') : t(locale, 'selectWikiEntry')}
          </div>
          <div className="mt-1 text-xs leading-relaxed text-muted-slate">
            {selectedEntry ? branchPath : t(locale, 'branchPathWillAppear')}
          </div>
        </section>

        {selectedProjectIds.size > 0 ? (
          <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
              <BookOpenText size={14} />
              {t(locale, 'activeFilters')}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...selectedProjectIds].map((projectId) => {
                const project = projects.find((item) => item.id === projectId)
                if (!project) return null

                return (
                  <button
                    key={project.id}
                    onClick={() => onToggleProjectFilter(project.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/40 px-3 py-1.5 text-xs text-muted-slate transition-colors hover:text-cohere-black"
                  >
                    {project.title}
                    <X size={12} />
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        <button
          onClick={async () => {
            if (!selectedEntry) return
            try {
              if (currentProject?.id !== selectedEntry.project.id) {
                await selectProject(selectedEntry.project.id)
              }
            } catch {
              // Even if project load fails, still attempt navigation
            }
            setFocusedNode(selectedEntry.node.id)
            setWorkspace('explore')
          }}
          disabled={!selectedEntry}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-cohere-black px-4 py-2.5 text-sm text-white transition-colors hover:bg-deep-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(locale, 'openInProject')}
          <ArrowRight size={15} />
        </button>
      </div>
    </aside>
  )
}
