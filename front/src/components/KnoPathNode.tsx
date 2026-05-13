import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Bookmark, BookmarkCheck, Bot, ChevronDown, ChevronUp, Minus, Square, Trash2, User } from 'lucide-react'

import { t } from '../lib/i18n'
import { useStore } from '../store'
import type { KnoPathNode } from '../types'

function KnoPathNodeComponent({ id, data, selected }: NodeProps<KnoPathNode>) {
  const locale = useStore((s) => s.settings.locale ?? 'zh')
  const createNode = useStore((state) => state.createNode)
  const removeNode = useStore((state) => state.removeNode)
  const setFocusedNode = useStore((state) => state.setFocusedNode)
  const toggleNodeBranchCollapsed = useStore((state) => state.toggleNodeBranchCollapsed)
  const toggleNodeCollapsed = useStore((state) => state.toggleNodeCollapsed)
  const toggleNodeMarked = useStore((state) => state.toggleNodeMarked)

  const isFocused = Boolean(data.isFocused)
  const opacity = data.hasActiveFocus && !isFocused ? 0.45 : 1

  const handleCreateBranch = async () => {
    setFocusedNode(id)
    await createNode(id, '')
  }

  return (
    <>
      <div
        data-node-id={id}
        tabIndex={0}
        className={[
          'rounded-card w-[300px] outline-none transition-all duration-200',
          selected
            ? 'border-2 border-olive-accent shadow-float'
            : 'border border-border-subtle/40 hover:border-border-subtle hover:shadow-float',
          isFocused ? 'shadow-float' : 'shadow-node',
        ].join(' ')}
        style={{ opacity, background: 'var(--glass-bg-strong)' }}
        onClick={() => {
          if (!isFocused) {
            setFocusedNode(id)
          }
        }}
        onFocus={() => {
          if (!isFocused) {
            setFocusedNode(id)
          }
        }}
      >
      <Handle type="target" position={Position.Left} className="!w-3.5 !h-3.5 !bg-olive-accent !border-2 !border-white" />

      <div className="flex h-full min-h-0 flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {data.type === 'root' ? (
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-card-sm" style={{ background: 'var(--olive-accent)' }}>
                  <User size={12} className="text-white" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] font-bold" style={{ color: 'var(--olive-accent)' }}>
                  Root
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-card-sm border" style={{ borderColor: 'var(--olive-accent)', background: 'var(--olive-highlight)' }}>
                  <Bot size={12} style={{ color: 'var(--olive-accent)' }} />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] font-bold" style={{ color: 'var(--text-muted)' }}>
                  Branch {(data.nodeDepth ?? 0)}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={(event) => {
                event.stopPropagation()
                void toggleNodeMarked(id)
              }}
              className="p-1.5 rounded-card-sm hover:bg-olive-highlight transition-all duration-200 cursor-pointer"
              title={data.isMarked ? t(locale, 'unmarkKey') : t(locale, 'markAsKey')}
            >
              {data.isMarked ? <BookmarkCheck size={14} style={{ color: 'var(--olive-accent)' }} /> : <Bookmark size={14} style={{ color: 'var(--text-muted)' }} />}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                void toggleNodeCollapsed(id)
              }}
              className="p-1.5 rounded-card-sm hover:bg-olive-highlight transition-all duration-200 cursor-pointer"
              title={data.isNodeCollapsed ? 'Expand node' : 'Collapse node'}
            >
              {data.isNodeCollapsed ? <Square size={14} style={{ color: 'var(--text-muted)' }} /> : <Minus size={14} style={{ color: 'var(--text-muted)' }} />}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                void toggleNodeBranchCollapsed(id)
              }}
              className="p-1.5 rounded-card-sm hover:bg-olive-highlight transition-all duration-200 cursor-pointer"
              title={data.isBranchCollapsed ? 'Expand branch' : 'Collapse branch'}
            >
              {data.isBranchCollapsed ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />}
            </button>
          </div>
        </div>

        <div
          className="mb-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1"
          onWheel={(event) => {
            event.stopPropagation()
          }}
        >
          <h3
            className="mb-3 overflow-hidden font-display text-[15px] leading-[1.4] tracking-[-0.01em]"
            style={{
              color: 'var(--text-main)',
              fontFamily: "var(--font-serif, 'Merriweather', Georgia, serif)",
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflowWrap: 'anywhere',
            }}
          >
            {data.question || t(locale, 'untitledPrompt')}
          </h3>

          {!data.isNodeCollapsed ? (
            <div className="min-w-0">
              <div
                className="rounded-card px-3.5 py-3"
                style={{ background: 'var(--bg-surface)' }}
              >
                <div
                  className="max-h-28 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed"
                  style={{ color: 'var(--text-main)', fontFamily: "var(--font-serif, 'Merriweather', Georgia, serif)", overflowWrap: 'anywhere' }}
                  onWheel={(event) => {
                    event.stopPropagation()
                  }}
                >
                  {data.question || 'Create this branch from the inspector to add a prompt.'}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {!data.isNodeCollapsed ? (
          <div
            className="mb-3 flex-shrink-0 rounded-card border border-border-subtle px-3.5 py-2.5 text-[12px] leading-relaxed"
            style={{
              borderLeft: '3px solid var(--olive-accent)',
              background: 'var(--bg-surface)',
              color: 'var(--text-muted)',
            }}
          >
            <span className="uppercase tracking-[0.12em] font-semibold text-[10px] text-olive-accent">{t(locale, 'summary')}</span>{' '}
            <span
              style={{
                fontFamily: "var(--font-serif, 'Merriweather', Georgia, serif)",
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {data.summary || 'Generate this node and inspect the full response in the right panel.'}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-3 mt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{data.childrenCount > 0 ? `${data.childrenCount} child branches` : 'No child branches yet'}</div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={(event) => {
                event.stopPropagation()
                void handleCreateBranch()
              }}
              className="flex items-center gap-1.5 rounded-card px-3 py-1.5 text-[11px] font-semibold transition-all duration-200 cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, var(--olive-accent) 0%, var(--olive-dark) 100%)',
                color: 'white',
                boxShadow: '0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.transform = 'translateY(-1px)'
                el.style.boxShadow = '0 4px 10px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.15)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.transform = 'translateY(0)'
                el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.15)'
              }}
            >
              {data.type === 'root' ? 'Branch' : 'Branch Here'}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                void removeNode(id)
              }}
              className="p-1.5 rounded-card-sm transition-all duration-200 cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.color = '#ef4444'
                el.style.background = 'rgba(239,68,68,0.08)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.color = 'var(--text-muted)'
                el.style.background = 'transparent'
              }}
              title="Delete branch"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!w-3.5 !h-3.5 !bg-olive-accent !border-2 !border-white" />
    </div>
  </>
  )
}

export default memo(KnoPathNodeComponent)
