import { useState, useCallback } from 'react'
import { FileText, RefreshCw } from 'lucide-react'

import { getWikiLogs, type LogEntry } from '../lib/api'
import { t } from '../lib/i18n'
import { useStore } from '../store'

const OPERATION_COLORS: Record<string, string> = {
  sync: 'bg-blue-100/60 text-blue-700',
  compile: 'bg-emerald-100/60 text-emerald-700',
  delete: 'bg-red-100/60 text-red-700',
  import: 'bg-purple-100/60 text-purple-700',
  lint: 'bg-amber-100/60 text-amber-700',
}

interface WikiLogsSectionProps {}

export default function WikiLogsSection({}: WikiLogsSectionProps) {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const [logsOpen, setLogsOpen] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filterProject, setFilterProject] = useState<string>('all')

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    try {
      const entries = await getWikiLogs()
      setLogEntries(entries)
    } catch {
      setLogEntries([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Toggle logs open/close
  const toggleLogs = useCallback(() => {
    setLogsOpen((open) => !open)
  }, [])

  // Get unique project IDs for filter
  const projectIds = [...new Set(logEntries.map(e => e.projectId).filter(Boolean))]

  // Filter entries by project
  const filteredEntries = filterProject === 'all'
    ? logEntries
    : logEntries.filter(e => e.projectId === filterProject)

  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <button
        onClick={toggleLogs}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] px-1 py-1 text-left transition-colors hover:text-cohere-black"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <FileText size={14} />
            {t(locale, 'operationLog')}
          </div>
          <div className="mt-2 text-sm text-cohere-black">
            {logEntries.length > 0
              ? (filterProject !== 'all' ? t(locale, 'logEntriesFiltered', filteredEntries.length) : `${filteredEntries.length} log entries`)
              : t(locale, 'viewOperationHistory')}
          </div>
        </div>
        <svg
          className={['h-4 w-4 shrink-0 text-muted-slate transition-transform', logsOpen ? 'rotate-180' : ''].join(' ')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {logsOpen && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchLogs()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-[12px] bg-white/50 px-3 py-1.5 text-xs text-cohere-black transition-colors hover:bg-white/70 disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              {t(locale, 'refresh')}
            </button>
            {projectIds.length > 0 && (
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="rounded-[12px] border border-white/30 bg-white/50 px-2 py-1.5 text-xs text-cohere-black"
              >
                <option value="all">{t(locale, 'allProjects2')}</option>
                {projectIds.map(id => (
                  <option key={id} value={id}>{id?.slice(0, 8)}...</option>
                ))}
              </select>
            )}
          </div>

          {filteredEntries.length > 0 ? (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {filteredEntries.map((entry, index) => (
                <div key={index} className="rounded-[14px] bg-white/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-slate">{entry.timestamp}</span>
                    <span className={['rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium', OPERATION_COLORS[entry.operation] ?? 'bg-gray-100/60 text-gray-700'].join(' ')}>
                      {entry.operation}
                    </span>
                    {entry.projectTitle && (
                      <span className="text-[10px] text-muted-slate">{entry.projectTitle}</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs font-medium text-cohere-black">{entry.title}</div>
                  {entry.details && (
                    <div className="mt-0.5 text-[11px] text-muted-slate">{entry.details}</div>
                  )}
                  {entry.pageTitles.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.pageTitles.slice(0, 5).map((title, i) => (
                        <span key={i} className="rounded-[4px] bg-olive-accent/8 px-1.5 py-0.5 text-[10px] text-olive-accent">
                          {title}
                        </span>
                      ))}
                      {entry.pageTitles.length > 5 && (
                        <span className="text-[10px] text-muted-slate">+{entry.pageTitles.length - 5} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[14px] bg-white/40 px-3 py-4 text-center text-sm text-muted-slate">
              {isLoading ? t(locale, 'loading') : filterProject !== 'all' ? t(locale, 'noLogsForProject') : t(locale, 'noOpsLogged')}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
