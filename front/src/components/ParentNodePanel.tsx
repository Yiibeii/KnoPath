import { Pin, PinOff, Bot, ArrowUpRight, ScrollText } from 'lucide-react'

import MarkdownContent from './MarkdownContent'
import { getParentPanelMeta } from '../lib/parentPanel'
import { t } from '../lib/i18n'
import { WORKSPACE_CHROME_LAYOUT } from '../lib/workspaceChromeLayout'
import { useStore } from '../store'

export default function ParentNodePanel() {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const { currentProject, focusedNodeId, parentPanelOpen, toggleParentPanel, setFocusedNode } = useStore()

  const focusedNode = currentProject?.nodes.find((node) => node.id === focusedNodeId) ?? null
  const parentNode = focusedNode?.data.parentId
    ? currentProject?.nodes.find((node) => node.id === focusedNode.data.parentId)
    : null

  if (!parentNode) return null

  const nodeDepth = (() => {
    if (!currentProject) return 0
    let depth = 0
    let current = currentProject.nodes.find((n) => n.id === focusedNodeId)
    while (current?.data.parentId) {
      depth++
      current = currentProject.nodes.find((n) => n.id === current?.data.parentId)
    }
    return depth
  })()
  const panelMeta = getParentPanelMeta(nodeDepth)

  if (!parentPanelOpen) {
    return (
      <button
        onClick={() => toggleParentPanel(true)}
        className={[
          WORKSPACE_CHROME_LAYOUT.iconButtonClassName,
          'absolute left-4 top-4 z-30 bg-white/65 shadow-[0_12px_32px_rgba(23,23,28,0.08)] backdrop-blur-xl',
        ].join(' ')}
        title={t(locale, 'showParentInfo')}
      >
        <Pin size={18} />
      </button>
    )
  }

  return (
    <div className="absolute left-4 top-4 z-30 w-[320px] rounded-card border border-white/30 bg-white/65 shadow-[0_18px_48px_rgba(23,23,28,0.12)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <Pin size={16} className="text-olive-accent" />
          <span className="text-sm font-medium text-cohere-black">{panelMeta.title}</span>
          <span className="rounded-full bg-olive-accent/10 px-2 py-0.5 text-[10px] font-mono text-olive-accent">
            {panelMeta.levelLabel}
          </span>
        </div>
        <button
          onClick={() => toggleParentPanel(false)}
          className={WORKSPACE_CHROME_LAYOUT.iconButtonClassName}
          title={t(locale, 'hideParentInfo')}
        >
          <PinOff size={16} />
        </button>
      </div>

      <div className="max-h-[calc(100vh-200px)] overflow-y-auto p-4">
        <button
          type="button"
          onClick={() => setFocusedNode(parentNode.id)}
          className="mb-4 block w-full rounded-[16px] border-2 border-olive-accent/20 bg-olive-accent/5 p-3 text-left transition-colors hover:border-olive-accent/40 hover:bg-olive-accent/10 focus:outline-none focus:ring-2 focus:ring-olive-accent/30"
          title={t(locale, 'focusParentNode')}
          aria-label={`${t(locale, 'focusParentNode')}: ${parentNode.data.question || t(locale, 'untitledPrompt')}`}
        >
          <div className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-olive-accent">
            <ArrowUpRight size={12} />
            {t(locale, 'jumpToParent')}
          </div>
          <div className="font-display text-[15px] leading-snug tracking-[-0.02em] text-cohere-black">
            {parentNode.data.question || t(locale, 'untitledPrompt')}
          </div>
        </button>

        <div className="mb-4 rounded-[16px] border border-white/25 bg-white/50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-muted-slate">
            <ScrollText size={12} />
            {t(locale, 'summary')}
          </div>
          <div className="max-h-24 overflow-y-auto text-xs leading-relaxed text-near-black">
            {parentNode.data.summary ? (
              <MarkdownContent content={parentNode.data.summary} className="text-xs leading-relaxed text-near-black" />
            ) : (
              t(locale, 'noSummaryYet')
            )}
          </div>
        </div>

        <div className="rounded-[16px] border border-white/25 bg-white/50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-muted-slate">
            <Bot size={12} />
            {t(locale, 'response')}
          </div>
          <div className="max-h-32 overflow-y-auto text-xs leading-relaxed text-near-black">
            {parentNode.data.answer ? (
              <MarkdownContent content={parentNode.data.answer} className="text-xs leading-relaxed text-near-black" />
            ) : (
              t(locale, 'noResponseYet2')
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
