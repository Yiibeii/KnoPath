import { useState } from 'react'
import { PencilLine } from 'lucide-react'

import type { AppSettings } from '../types'
import { t } from '../lib/i18n'
import { useStore } from '../store'

type TemplateKey = keyof AppSettings['knowledgeBase']['templates']

const templateLabels: Record<TemplateKey, string> = {
  readme: 'README.md',
  claude: 'CLAUDE.md',
  index: 'index.md',
}

interface InsightTemplatesProps {
  settings: AppSettings
  activeTemplateKey: TemplateKey
  onUpdateTemplate: (key: TemplateKey, value: string) => Promise<void>
}

export default function InsightTemplates({
  settings,
  activeTemplateKey,
  onUpdateTemplate,
}: InsightTemplatesProps) {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const [editingTemplateKey, setEditingTemplateKey] = useState<TemplateKey | null>(null)
  const [templateDraft, setTemplateDraft] = useState('')

  const startTemplateEditing = (key: TemplateKey) => {
    setEditingTemplateKey(key)
    setTemplateDraft(settings.knowledgeBase.templates[key])
  }

  const saveTemplateEditing = async () => {
    if (!editingTemplateKey) return
    await onUpdateTemplate(editingTemplateKey, templateDraft)
    setEditingTemplateKey(null)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-card border border-white/30 bg-white/65 p-6 shadow-[0_20px_48px_rgba(23,23,28,0.06)] backdrop-blur-xl">
        <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'knowledgeBaseTemplates')}</div>
        <h1 className="mt-2 font-display text-[34px] leading-[1.05] tracking-[-0.04em] text-cohere-black">
          {t(locale, 'editInsightTemplates')}
        </h1>
        <div className="mt-3 text-sm text-muted-slate">
          {t(locale, 'templatesDesc')}
        </div>

        <section className="mt-6 rounded-[22px] border border-white/25 bg-white/40 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-slate">{t(locale, 'templateFile')}</div>
              <div className="mt-1 text-base font-medium text-cohere-black">{templateLabels[activeTemplateKey]}</div>
            </div>
            <PencilLine size={15} className="text-muted-slate" />
          </div>

          {editingTemplateKey === activeTemplateKey ? (
            <textarea
              value={templateDraft}
              onChange={(event) => setTemplateDraft(event.target.value)}
              onBlur={() => void saveTemplateEditing()}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void saveTemplateEditing()
                }
                if (event.key === 'Escape') {
                  setEditingTemplateKey(null)
                }
              }}
              className="mt-3 min-h-[220px] w-full rounded-[16px] border border-white/30 bg-white/50 px-4 py-3 font-mono text-xs leading-relaxed text-near-black outline-none transition-colors focus:border-olive-accent"
              autoFocus
            />
          ) : (
            <pre
              onDoubleClick={() => startTemplateEditing(activeTemplateKey)}
              className="mt-3 cursor-text whitespace-pre-wrap break-words rounded-[16px] bg-white/90 px-4 py-3 font-mono text-xs leading-relaxed text-near-black"
            >
              {settings.knowledgeBase.templates[activeTemplateKey]}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}

export type { TemplateKey }
export { templateLabels }
