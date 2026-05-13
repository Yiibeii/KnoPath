import { useMemo, useState } from 'react'
import { Download, FileText, Layers, RefreshCw, Table, X } from 'lucide-react'

import { downloadMarkdown, generateMarkdown } from '../lib/export'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { SummaryMode } from '../types'

const summaryModes: { id: SummaryMode; label: string; icon: React.ReactNode }[] = [
  { id: 'outline', label: 'Outline', icon: <Layers size={16} /> },
  { id: 'compare', label: 'Compare', icon: <Table size={16} /> },
  { id: 'flashcard', label: 'Flashcards', icon: <FileText size={16} /> },
]

export default function BottomPanel() {
  const locale = useStore((s) => s.settings.locale ?? 'zh')
  const { currentProject, markedNodes, summaryMode, setSummaryMode, toggleBottomPanel, setNotice } = useStore()
  const [isExporting, setIsExporting] = useState(false)

  const compareContent = useMemo(() => {
    if (!currentProject) return ''
    const rootNode = currentProject.nodes.find((node) => node.data.parentId === null)
    if (!rootNode) return t(locale, 'createRootFirst')

    const branches = currentProject.edges
      .filter((edge) => edge.source === rootNode.id)
      .map((edge) => currentProject.nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))

    if (branches.length < 2) return t(locale, 'createTwoBranches')

    return [
      `| Dimension | ${branches.map((branch) => branch.data.question).join(' | ')} |`,
      `| --- | ${branches.map(() => '---').join(' | ')} |`,
      `| Summary | ${branches.map((branch) => branch.data.summary || t(locale, 'pendingSummary')).join(' | ')} |`,
      `| Key takeaway | ${branches.map((branch) => (branch.data.isMarked ? t(locale, 'markedAsKey') : t(locale, 'notMarked'))).join(' | ')} |`,
    ].join('\n')
  }, [currentProject, locale])

  const flashcardContent = useMemo(() => {
    if (!currentProject) return ''

    return currentProject.nodes
      .filter((node) => node.data.isMarked || node.data.type === 'root')
      .map(
        (node) =>
          `Q: ${node.data.question}\nA: ${node.data.summary || node.data.answer || t(locale, 'pendingAnswer')}`,
      )
      .join('\n\n---\n\n')
  }, [currentProject, locale])

  if (!currentProject) return null

  const markdown = generateMarkdown(currentProject, markedNodes)
  const content = summaryMode === 'outline' ? markdown : summaryMode === 'compare' ? compareContent : flashcardContent

  const handleExportMarkdown = async () => {
    setIsExporting(true)
    try {
      downloadMarkdown(currentProject, markedNodes)
      setNotice(t(locale, 'markdownExported'))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="h-72 border-t border-white/30 bg-white/55 backdrop-blur-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/20">
        <div className="flex items-center gap-4">
          <h3 className="font-display font-medium text-sm">{t(locale, 'summaryPreview')}</h3>

          <div className="flex items-center gap-1 bg-white/40 rounded-lg p-1">
            {summaryModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setSummaryMode(mode.id)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer',
                  summaryMode === mode.id ? 'bg-white/70 text-cohere-black shadow-sm' : 'text-muted-slate hover:text-cohere-black',
                ].join(' ')}
              >
                {mode.icon}
                {t(locale, mode.id === 'outline' ? 'outlineMode' : mode.id === 'compare' ? 'compareMode' : 'flashcardsMode')}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-slate">{t(locale, 'keyConclusionsCollected', markedNodes.length)}</span>

          <button
            onClick={() => void handleExportMarkdown()}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-olive-accent text-white rounded-lg text-xs hover:bg-olive-accent/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isExporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            {t(locale, 'markdown2')}
          </button>

          <button onClick={toggleBottomPanel} className="p-1.5 hover:bg-white/50 rounded-lg transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <pre className="text-sm text-near-black whitespace-pre-wrap font-mono">{content || t(locale, 'noContentYet')}</pre>
      </div>
    </div>
  )
}
