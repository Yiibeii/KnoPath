import { useState, useCallback } from 'react'
import { AlertTriangle, CheckCircle, Shield, Wrench } from 'lucide-react'

import { getWikiLintAll, type LintResult } from '../lib/api'
import { t } from '../lib/i18n'
import { useStore } from '../store'

interface WikiLintSectionProps {
  onSelectWikiPage?: (pageId: string) => void
}

export default function WikiLintSection({ onSelectWikiPage }: WikiLintSectionProps) {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const [lintOpen, setLintOpen] = useState(false)
  const [lintResults, setLintResults] = useState<Record<string, LintResult>>({})
  const [isLoading, setIsLoading] = useState(false)

  const runLint = useCallback(async (autoFix: boolean = false) => {
    setIsLoading(true)
    try {
      const results = await getWikiLintAll(autoFix)
      setLintResults(results)
    } catch {
      setLintResults({})
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Calculate overall health status
  const hasIssues = Object.values(lintResults).some(result => !result.isHealthy)
  const totalPages = Object.values(lintResults).reduce((sum, result) => sum + result.pageCount, 0)
  const totalIssues = Object.values(lintResults).reduce((sum, result) => sum + result.orphanPages.length + result.missingLinks.length, 0)
  const projectCount = Object.keys(lintResults).length

  return (
    <section className="mt-3 rounded-card border border-white/30 bg-white/60 p-3 backdrop-blur-xl">
      <button
        onClick={() => setLintOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] px-1 py-1 text-left transition-colors hover:text-cohere-black"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
            <Shield size={14} />
            {t(locale, 'healthCheck')}
          </div>
          <div className="mt-2 text-sm text-cohere-black">
            {projectCount > 0
              ? hasIssues
                ? t(locale, 'issuesFound', totalIssues, projectCount)
                : t(locale, 'pagesHealthy', totalPages, projectCount)
              : t(locale, 'runHealthCheck')}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {Object.keys(lintResults).length > 0 && (
            hasIssues
              ? <AlertTriangle size={14} className="text-amber-500" />
              : <CheckCircle size={14} className="text-emerald-500" />
          )}
          <svg
            className={['h-4 w-4 shrink-0 text-muted-slate transition-transform', lintOpen ? 'rotate-180' : ''].join(' ')}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {lintOpen && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => void runLint(false)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-[12px] bg-white/50 px-3 py-1.5 text-xs text-cohere-black transition-colors hover:bg-white/70 disabled:opacity-50"
            >
              <Shield size={12} />
              {t(locale, 'checkNow')}
            </button>
            <button
              onClick={() => void runLint(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-[12px] bg-olive-accent/10 px-3 py-1.5 text-xs text-olive-accent transition-colors hover:bg-olive-accent/20 disabled:opacity-50"
            >
              <Wrench size={12} />
              {t(locale, 'fixIssues')}
            </button>
          </div>

          {Object.keys(lintResults).length > 0 && (
            <>
              <div className="rounded-[14px] bg-white/40 px-3 py-2 text-[11px] text-muted-slate">
                {t(locale, 'pagesAcrossProjects', totalPages, projectCount)}
                {Object.values(lintResults).some(r => r.brokenLinksRemoved > 0) &&
                  ` · ${t(locale, 'brokenLinksRemoved', Object.values(lintResults).reduce((sum, r) => sum + r.brokenLinksRemoved, 0))}`}
              </div>

              {Object.entries(lintResults).map(([projectId, result]) => {
                if (result.orphanPages.length === 0 && result.missingLinks.length === 0) {
                  return null
                }
                return (
                  <div key={projectId} className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-slate">
                      {t(locale, 'projectLabel')} {projectId.slice(0, 8)}
                    </div>

                    {result.orphanPages.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-amber-600">{t(locale, 'orphanPages')}</div>
                        {result.orphanPages.map((orphan) => (
                          <button
                            key={orphan.pageId}
                            onClick={() => onSelectWikiPage?.(orphan.pageId)}
                            className="block w-full rounded-[12px] bg-amber-50/60 px-3 py-2 text-left text-xs text-cohere-black transition-colors hover:bg-amber-100/60"
                          >
                            <span className="font-medium">{orphan.title}</span>
                            <span className="ml-2 text-muted-slate">{orphan.reason}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {result.missingLinks.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-red-500">{t(locale, 'missingLinks')}</div>
                        {result.missingLinks.map((link, i) => (
                          <button
                            key={i}
                            onClick={() => onSelectWikiPage?.(link.sourcePageId)}
                            className="block w-full rounded-[12px] bg-red-50/60 px-3 py-2 text-left text-xs text-cohere-black transition-colors hover:bg-red-100/60"
                          >
                            <span className="font-medium">{link.sourceTitle}</span>
                            <span className="text-muted-slate"> → </span>
                            <span className="italic">{link.referencedTitle}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {Object.values(lintResults).every(r => r.suggestions.length === 0) && (
                <div className="rounded-[14px] bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700">
                  {t(locale, 'allPagesHealthy')}
                </div>
              )}
            </>
          )}

          {Object.keys(lintResults).length === 0 && !isLoading && (
            <div className="rounded-[14px] bg-white/40 px-3 py-4 text-center text-sm text-muted-slate">
              {t(locale, 'clickCheckToRun')}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
