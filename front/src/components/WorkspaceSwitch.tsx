import { BookOpenText, Orbit } from 'lucide-react'

import { t } from '../lib/i18n'
import { useStore } from '../store'

export default function WorkspaceSwitch() {
  const locale = useStore((s) => s.settings.locale ?? 'zh')
  const { currentWorkspace, setWorkspace } = useStore()

  return (
    <div className="flex h-[54px] items-center justify-between border-b border-white/20 bg-white/50 px-5 backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'knowledgeWorkspace')}</div>
          <div className="mt-0.5 font-display text-[24px] leading-none tracking-[-0.03em] text-cohere-black">KnoPath</div>
        </div>
        <div className="inline-flex items-center rounded-full border border-white/25 bg-white/35 p-1">
          <button
            onClick={() => setWorkspace('explore')}
            className={[
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors',
              currentWorkspace === 'explore'
                ? 'bg-white/60 text-cohere-black shadow-[0_8px_18px_rgba(23,23,28,0.08)]'
                : 'text-muted-slate hover:text-cohere-black',
            ].join(' ')}
          >
            <Orbit size={15} />
            {t(locale, 'explore')}
          </button>
          <button
            onClick={() => setWorkspace('insight')}
            className={[
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors',
              currentWorkspace === 'insight'
                ? 'bg-white/60 text-cohere-black shadow-[0_8px_18px_rgba(23,23,28,0.08)]'
                : 'text-muted-slate hover:text-cohere-black',
            ].join(' ')}
          >
            <BookOpenText size={15} />
            {t(locale, 'insight')}
          </button>
        </div>
      </div>
      <div className="text-xs text-muted-slate">
        {currentWorkspace === 'explore' ? t(locale, 'exploreBranchingTrees') : t(locale, 'browseCompiledKnowledge')}
      </div>
    </div>
  )
}
