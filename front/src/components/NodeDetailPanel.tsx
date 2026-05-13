import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, BookmarkCheck, Clock3, Compass, GripVertical, LoaderCircle, MessageSquarePlus, MessageSquareText, Sparkles, ArrowDownRight, ArrowRight, Target } from 'lucide-react'

import MarkdownContent from './MarkdownContent'
import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { ExplorationDirection } from '../types'

const MIN_PANEL_WIDTH = 300
const MAX_PANEL_WIDTH = 600
const DEFAULT_PANEL_WIDTH = 380

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function NodeDetailPanel() {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const {
    currentProject,
    focusedNodeId,
    createNode,
    generateNodeAnswer,
    updateNodeQuestion,
    setFocusedNode,
    setNotice,
    toggleNodeMarked,
    searchHighlight,
  } = useStore()
  const [promptDraftState, setPromptDraftState] = useState<{ nodeId: string | null; value: string }>({
    nodeId: null,
    value: '',
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [responseSelectionMenu, setResponseSelectionMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const selectionTextRef = useRef('')

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setIsResizing(true)
    resizeRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    }
  }, [panelWidth])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startX - event.clientX
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, resizeRef.current.startWidth + delta))
      setPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const focusedNode = currentProject?.nodes.find((node) => node.id === focusedNodeId) ?? null
  const promptValue =
    focusedNode && promptDraftState.nodeId === focusedNode.id ? promptDraftState.value : (focusedNode?.data.question ?? '')
  const hasPromptChanges = useMemo(
    () => promptValue.trim() !== (focusedNode?.data.question ?? '').trim(),
    [focusedNode?.data.question, promptValue],
  )

  useEffect(() => {
    if (!focusedNode || focusedNode.data.question.trim()) return
    requestAnimationFrame(() => promptRef.current?.focus())
  }, [focusedNode?.id, focusedNode?.data.question])

  useEffect(() => {
    if (!responseSelectionMenu) return

    const closeMenu = () => setResponseSelectionMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [responseSelectionMenu])

  const handleGenerate = async () => {
    if (!currentProject || !focusedNode) return

    const nextPrompt = promptValue.trim()
    if (!nextPrompt) {
      setNotice(t(locale, 'enterPromptFirst'))
      return
    }

    setIsGenerating(true)
    await updateNodeQuestion(focusedNode.id, nextPrompt)
    await generateNodeAnswer(focusedNode.id)
    setIsGenerating(false)
    requestAnimationFrame(() => {
      const nodeElement = document.querySelector<HTMLElement>(`[data-node-id="${focusedNode.id}"]`)
      nodeElement?.focus()
    })
  }

  const syncResponseSelection = () => {
    const selection = window.getSelection()?.toString().trim() ?? ''
    selectionTextRef.current = selection
  }

  const handleCreateBranchFromResponseSelection = async () => {
    if (!focusedNode || !responseSelectionMenu?.text.trim()) return
    setResponseSelectionMenu(null)
    setFocusedNode(focusedNode.id)
    await createNode(focusedNode.id, responseSelectionMenu.text.trim())
  }

  if (!currentProject) return null

  return (
    <aside
      className="flex flex-col border-l border-white/30 bg-white/55 backdrop-blur-xl relative"
      style={{ width: panelWidth }}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize group z-10 ${isResizing ? 'bg-olive-accent/30' : 'hover:bg-olive-accent/20'}`}
        onMouseDown={handleResizeStart}
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical size={14} className="text-muted-slate" />
        </div>
      </div>
      <div className="border-b border-white/20 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted-slate">
            <MessageSquareText size={14} />
            {t(locale, 'nodeConversation')}
          </div>
          {focusedNode ? (
            <button
              onClick={() => void toggleNodeMarked(focusedNode.id)}
              className={[
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] transition-colors',
                focusedNode.data.isMarked
                  ? 'border-olive-accent/25 bg-olive-accent/10 text-olive-accent hover:bg-olive-accent/15'
                  : 'border-white/30 bg-white/50 text-muted-slate hover:bg-white/60 hover:text-cohere-black',
              ].join(' ')}
              title={focusedNode.data.isMarked ? t(locale, 'unmarkKey') : t(locale, 'markAsKey')}
            >
              <BookmarkCheck size={13} />
              {focusedNode.data.isMarked ? t(locale, 'marked') : t(locale, 'mark')}
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl tracking-[-0.03em] text-cohere-black">
              {focusedNode ? focusedNode.data.question || t(locale, 'untitledNode') : t(locale, 'selectNode')}
            </h2>
            {focusedNode ? (
              <div className="mt-2 space-y-1 text-xs text-muted-slate">
                <div>{t(locale, 'updated')} {formatTime(focusedNode.data.updatedAt)}</div>
                <div className="truncate whitespace-nowrap">{t(locale, 'model')} {focusedNode.data.model || t(locale, 'localMockPending')}</div>
                {focusedNode.data.insightUpdatedAt ? (
                  <div>{t(locale, 'insightPrefix')} {formatTime(focusedNode.data.insightUpdatedAt)}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {focusedNode ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
              <MessageSquarePlus size={14} />
              {t(locale, 'question')}
            </div>
            <textarea
              ref={promptRef}
              value={promptValue}
              onChange={(event) =>
                setPromptDraftState({
                  nodeId: focusedNode.id,
                  value: event.target.value.slice(0, 1200),
                })
              }
              placeholder={focusedNode.data.type === 'root' ? t(locale, 'rootPlaceholder') : t(locale, 'childPlaceholder')}
              data-shortcut-target="prompt-input"
              className="mt-3 min-h-[120px] w-full resize-none rounded-card-sm border border-white/30 bg-white/40 px-4 py-3 text-sm leading-relaxed text-near-black outline-none transition-colors focus:border-olive-accent focus:ring-2 focus:ring-olive-accent/20"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-slate">
                {focusedNode.data.type === 'root'
                  ? t(locale, 'rootNode')
                  : t(locale, 'childNode')}
              </div>
              <div className="text-xs text-muted-slate">{t(locale, 'turns')} {focusedNode.data.turnCount ?? 0}</div>
              <button
                onClick={() => void handleGenerate()}
                disabled={!promptValue.trim() || isGenerating}
                data-shortcut-target="generate-node"
                className="inline-flex items-center gap-2 rounded-full bg-cohere-black px-4 py-2 text-sm font-semibold text-white transition-all duration-200 shadow-btn hover:shadow-btn-hover hover:bg-deep-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {focusedNode.data.answer ? (hasPromptChanges ? t(locale, 'updatedPrompt') : t(locale, 'regenerate')) : t(locale, 'generate')}
              </button>
            </div>
          </section>

          <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
              <Bot size={14} />
              {t(locale, 'response')}
            </div>
            <div
              className="mt-3 select-text text-sm leading-relaxed text-near-black"
              onMouseUp={syncResponseSelection}
              onKeyUp={syncResponseSelection}
              onContextMenu={(event) => {
                const selection = selectionTextRef.current || window.getSelection()?.toString().trim() || ''
                if (!selection.trim()) return
                event.preventDefault()
                event.stopPropagation()
                setResponseSelectionMenu({
                  x: event.clientX,
                  y: event.clientY,
                  text: selection.trim(),
                })
              }}
            >
              {focusedNode.data.answer ? (
                <MarkdownContent content={focusedNode.data.answer} className="text-sm leading-relaxed text-near-black" highlightQuery={searchHighlight?.matchedField === 'answer' ? searchHighlight.query : undefined} />
              ) : isGenerating ? (
                t(locale, 'generatingResponse')
              ) : (
                t(locale, 'noResponseYet')
              )}
            </div>
          </section>

          <section
            className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl"
            style={{ borderLeft: '3px solid var(--olive-highlight)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
                <BookmarkCheck size={14} />
                {t(locale, 'summary')}
              </div>
              {focusedNode.data.insightUpdatedAt ? (
                <div className="shrink-0 text-[11px] text-muted-slate">
                  {t(locale, 'insightPrefix')} {formatTime(focusedNode.data.insightUpdatedAt)}
                </div>
              ) : null}
            </div>
            <div className="mt-3 text-sm leading-relaxed text-near-black">
              {focusedNode.data.summary ? (
                <MarkdownContent content={focusedNode.data.summary} className="text-sm leading-relaxed text-near-black" highlightQuery={searchHighlight?.matchedField === 'summary' ? searchHighlight.query : undefined} />
              ) : (
                t(locale, 'noSummaryYet')
              )}
            </div>
          </section>

          {focusedNode.data.exploration && (
            (focusedNode.data.exploration.deep?.length ?? 0) +
            (focusedNode.data.exploration.lateral?.length ?? 0) +
            (focusedNode.data.exploration.applied?.length ?? 0)
          ) > 0 && (
            <section
              className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl"
              style={{ borderLeft: '3px solid var(--olive-accent)' }}
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
                <Compass size={14} />
                {t(locale, 'exploration')}
              </div>
              <div className="mt-3 space-y-4">
                {(['deep', 'lateral', 'applied'] as ExplorationDirection[]).map((direction) => {
                  const options = focusedNode.data.exploration?.[direction] ?? []
                  if (options.length === 0) return null
                  const getLabel = (d: ExplorationDirection) => {
                    switch (d) {
                      case 'deep': return t(locale, 'deepDive')
                      case 'lateral': return t(locale, 'lateralExplore')
                      case 'applied': return t(locale, 'appliedScenarios')
                    }
                  }
                  const getIcon = (d: ExplorationDirection) => {
                    switch (d) {
                      case 'deep': return <ArrowDownRight size={12} />
                      case 'lateral': return <ArrowRight size={12} />
                      case 'applied': return <Target size={12} />
                    }
                  }
                  const getColor = (d: ExplorationDirection) => {
                    switch (d) {
                      case 'deep': return { bg: 'bg-blue-50', text: 'text-blue-600', icon: 'text-blue-500', border: 'border-blue-200/60' }
                      case 'lateral': return { bg: 'bg-purple-50', text: 'text-purple-600', icon: 'text-purple-500', border: 'border-purple-200/60' }
                      case 'applied': return { bg: 'bg-amber-50', text: 'text-amber-600', icon: 'text-amber-500', border: 'border-amber-200/60' }
                    }
                  }
                  const colors = getColor(direction)
                  return (
                    <div key={direction}>
                      <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] mb-2 ${colors.text}`}>
                        <div className={`flex h-5 w-5 items-center justify-center rounded-[6px] ${colors.bg}`}>
                          <span className={colors.icon}>{getIcon(direction)}</span>
                        </div>
                        {getLabel(direction)}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {options.map((option, index) => (
                          <span
                            key={index}
                            className={`inline-flex items-center rounded-[10px] border ${colors.border} ${colors.bg} px-3 py-1.5 text-xs font-medium text-near-black transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]`}
                          >
                            {option}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="rounded-card border border-white/30 bg-white/60 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-slate">
              <Clock3 size={14} />
              {t(locale, 'contextSnapshot')}
            </div>
            <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-slate">
              {focusedNode.data.context || t(locale, 'focusNodeForContext')}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-5">
          <div className="rounded-card border border-white/30 bg-white/60 px-6 py-5 text-sm text-muted-slate text-center backdrop-blur-xl">
            {t(locale, 'clickNodeToEdit')}
          </div>
        </div>
      )}

      {responseSelectionMenu ? (
        <div
          className="fixed z-[90] min-w-[220px] rounded-[16px] border border-white/30 bg-white/75 p-2 shadow-menu backdrop-blur-xl"
          style={{ left: responseSelectionMenu.x, top: responseSelectionMenu.y + 6 }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => void handleCreateBranchFromResponseSelection()}
            className="flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left text-sm text-near-black transition-all duration-200 hover:bg-olive-highlight"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-card-sm bg-olive-accent/10">
              <MessageSquarePlus size={14} className="text-olive-accent" />
            </div>
            <span className="font-medium">{t(locale, 'newBranchFromSelection')}</span>
          </button>
        </div>
      ) : null}
    </aside>
  )
}
