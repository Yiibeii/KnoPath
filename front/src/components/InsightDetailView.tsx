import MarkdownContent from './MarkdownContent'
import { formatTime, type InsightEntry } from '../lib/insightUtils'
import { getInsightDisplayTitle } from '../lib/insightEntry'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { WikiPage } from '../types'
import type { InsightOutlineItem } from '../lib/insightOutline'

interface InsightDetailViewProps {
  selectedEntry: InsightEntry | null
  selectedPage: WikiPage | null
  viewMode: 'wiki' | 'raw'
  headingPrefix: string
  outlineItems: InsightOutlineItem[]
  highlightQuery?: string
}

export default function InsightDetailView({
  selectedEntry,
  selectedPage,
  viewMode,
  headingPrefix,
  outlineItems,
  highlightQuery,
}: InsightDetailViewProps) {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const displayTitle = selectedPage?.title || (selectedEntry ? getInsightDisplayTitle(selectedEntry.node.data.summary, selectedEntry.node.data.question) : t(locale, 'untitled'))

  if (viewMode === 'raw' && selectedEntry) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-card border border-white/30 bg-white/65 p-6 shadow-[0_20px_48px_rgba(23,23,28,0.06)] backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'rawData')}</div>
          <h1 className="mt-2 font-display text-[34px] leading-[1.05] tracking-[-0.04em] text-cohere-black">
            {selectedEntry.node.data.question || t(locale, 'untitledNode')}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-slate">
            <span>{t(locale, 'created')} {formatTime(selectedEntry.node.data.createdAt)}</span>
            <span>{selectedEntry.project.title}</span>
          </div>

          <div className="mt-6 rounded-[22px] border border-white/25 bg-white/40 px-5 py-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'question')}</div>
            <div className="mt-2 text-base leading-relaxed text-near-black">
              {selectedEntry.node.data.question || t(locale, 'noQuestion')}
            </div>
          </div>

          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'answer')}</div>
            <div className="mt-3 text-sm leading-relaxed text-near-black">
              {selectedEntry.node.data.answer ? (
                <MarkdownContent
                  content={selectedEntry.node.data.answer}
                  className="text-sm leading-relaxed text-near-black"
                  highlightQuery={highlightQuery}
                />
              ) : (
                <div className="text-muted-slate">{t(locale, 'noAnswerYet')}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!selectedPage) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-card border border-white/30 bg-white/65 p-6 shadow-[0_20px_48px_rgba(23,23,28,0.06)] backdrop-blur-xl">
          <div className="text-muted-slate">{t(locale, 'noWikiPageSelected')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-card border border-white/30 bg-white/65 p-6 shadow-[0_20px_48px_rgba(23,23,28,0.06)] backdrop-blur-xl">
        <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'wikiPage')}</div>
        <h1
          id={`${headingPrefix}-${outlineItems[0]?.id ?? 'root'}`}
          className="mt-2 cursor-text font-display text-[34px] leading-[1.05] tracking-[-0.04em] text-cohere-black"
        >
          {displayTitle}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-slate">
          <span>{t(locale, 'compiled')} {formatTime(selectedPage.updatedAt ?? selectedPage.compiledAt ?? undefined)}</span>
          {selectedEntry && <span>{selectedEntry.project.title}</span>}
        </div>

        {selectedPage.summary && (
          <div className="mt-6 rounded-[22px] border border-white/25 bg-white/40 px-5 py-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'summary')}</div>
            <div className="mt-2 text-base leading-relaxed text-near-black">
              {selectedPage.summary}
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'content')}</div>
          <div className="mt-3 text-sm leading-relaxed text-near-black">
            {selectedPage.content ? (
              <MarkdownContent
                content={selectedPage.content}
                className="text-sm leading-relaxed text-near-black"
                highlightQuery={highlightQuery}
              />
            ) : (
              <div className="text-muted-slate">{t(locale, 'noContentYet2')}</div>
            )}
          </div>
        </div>

        {selectedPage.sourceReferences && selectedPage.sourceReferences.length > 0 && (
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'sourceReferences')}</div>
            <div className="mt-2 text-sm text-muted-slate">
              {selectedPage.sourceReferences.map((ref, index) => (
                <div key={index}>{ref}</div>
              ))}
            </div>
          </div>
        )}

        {selectedPage.relatedTopics && selectedPage.relatedTopics.length > 0 && (
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'relatedTopics')}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedPage.relatedTopics.map((topic, index) => (
                <span key={index} className="rounded-full bg-white/40 px-3 py-1 text-xs text-muted-slate">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
