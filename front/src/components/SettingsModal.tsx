import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, RotateCcw, Save, X } from 'lucide-react'

import { useStore } from '../store'
import type { AppSettings } from '../types'
import { isElectron, selectDirectoryElectron } from '../lib/electronFS'
import { updateRepositorySettings, getDefaultPrompt } from '../lib/api'
import { t } from '../lib/i18n'

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    model: { ...settings.model },
    knowledgeBase: {
      ...settings.knowledgeBase,
      templates: { ...settings.knowledgeBase.templates },
    },
    explorationMode: settings.explorationMode ?? 'direct',
    theme: settings.theme ?? 'light',
    locale: settings.locale ?? 'zh',
  }
}

export default function SettingsModal() {
  const { settings, settingsOpen, setSettingsOpen, updateSettings, setNotice, importFromRepository, setSettings } = useStore()
  const [draft, setDraft] = useState<AppSettings>(cloneSettings(settings))
  const [isImporting, setIsImporting] = useState(false)
  const [defaultPrompt, setDefaultPrompt] = useState<string>('')
  const locale = draft.locale ?? 'zh'

  useEffect(() => {
    if (settingsOpen) {
      setDraft(cloneSettings(settings))
      getDefaultPrompt(settings.locale ?? 'zh').then(setDefaultPrompt).catch(() => setDefaultPrompt(''))
    } else {
      // Revert theme to saved value when modal closes (cancel)
      document.documentElement.dataset.theme = settings.theme ?? 'light'
    }
  }, [settings, settingsOpen])

  const handleChooseDirectory = async () => {
    if (isElectron()) {
      try {
        const dirPath = await selectDirectoryElectron()
        if (dirPath) {
          setDraft((current) => ({
            ...current,
            knowledgeBase: {
              ...current.knowledgeBase,
              directoryPath: dirPath,
              directoryName: dirPath.split(/[/\\]/).pop() || dirPath,
              lastValidated: new Date().toISOString(),
            },
          }))
          
          setIsImporting(true)
          try {
            await updateRepositorySettings(dirPath)
            const newSettings = {
              ...settings,
              knowledgeBase: {
                ...settings.knowledgeBase,
                directoryPath: dirPath,
                directoryName: dirPath.split(/[/\\]/).pop() || dirPath,
              },
            }
            setSettings(newSettings)
            setDraft(cloneSettings(newSettings))
            await importFromRepository()
          } catch (error) {
            console.error('Auto sync failed:', error)
            setNotice(t(locale, 'autoSyncFailed'))
          } finally {
            setIsImporting(false)
          }
        }
      } catch (error) {
        setNotice(t(locale, 'dirSelectFailed'))
      }
    } else {
      const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      if (!picker) {
        setNotice(t(locale, 'browserNotSupported'))
        return
      }

      try {
        const handle = await picker()
        setDraft((current) => ({
          ...current,
          knowledgeBase: {
            ...current.knowledgeBase,
            directoryName: handle.name,
            directoryHandle: handle,
            lastValidated: new Date().toISOString(),
          },
        }))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setNotice(t(locale, 'dirSelectFailed'))
      }
    }
  }

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-deep-dark/30 px-4">
      <div className="absolute inset-0" onClick={() => setSettingsOpen(false)} />

      <div className="relative flex max-h-[calc(100vh-40px)] w-full max-w-2xl flex-col rounded-card border border-white/30 bg-white/75 shadow-overlay backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/20 px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-cohere-black">{t(locale, 'settingsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-slate">{t(locale, 'settingsDesc')}</p>
          </div>

          <button onClick={() => setSettingsOpen(false)} className="rounded-card-sm p-2 hover:bg-white/50 transition-all duration-200 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto px-5 py-5 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-near-black">{t(locale, 'provider')}</span>
            <input value="OpenAI-compatible" disabled className="rounded-card-sm border border-white/30 bg-white/40 px-3 py-2 text-muted-slate" />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-near-black">{t(locale, 'modelLabel')}</span>
            <input
              value={draft.model.model}
              onChange={(event) => setDraft((current) => ({ ...current, model: { ...current.model, model: event.target.value } }))}
              className="rounded-card-sm border border-white/30 px-3 py-2 input-focus"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm md:col-span-2">
            <span className="text-near-black">{t(locale, 'apiBaseUrl')}</span>
            <input
              value={draft.model.baseUrl}
              onChange={(event) => setDraft((current) => ({ ...current, model: { ...current.model, baseUrl: event.target.value } }))}
              className="rounded-card-sm border border-white/30 px-3 py-2 input-focus"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm md:col-span-2">
            <span className="text-near-black">{t(locale, 'apiKey')}</span>
            <input
              type="password"
              value={draft.model.apiKey}
              onChange={(event) => setDraft((current) => ({ ...current, model: { ...current.model, apiKey: event.target.value } }))}
              className="rounded-card-sm border border-white/30 px-3 py-2 input-focus"
              placeholder="sk-..."
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-near-black">{t(locale, 'temperature')}</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={draft.model.temperature}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  model: { ...current.model, temperature: Number(event.target.value || 0) },
                }))
              }
              className="rounded-card-sm border border-white/30 px-3 py-2 input-focus"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm md:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-near-black">{t(locale, 'systemPrompt')}</span>
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, model: { ...current.model, systemPrompt: defaultPrompt } }))}
                className="inline-flex items-center gap-1 text-xs text-muted-slate hover:text-olive-accent transition-colors"
                title={t(locale, 'resetToDefault')}
                disabled={!defaultPrompt}
              >
                <RotateCcw size={12} />
                {t(locale, 'resetToDefault')}
              </button>
            </div>
            <textarea
              value={draft.model.systemPrompt}
              onChange={(event) => setDraft((current) => ({ ...current, model: { ...current.model, systemPrompt: event.target.value } }))}
              className="min-h-[120px] rounded-card-sm border border-white/30 px-3 py-2 input-focus"
              placeholder={t(locale, 'systemPromptPlaceholder')}
            />
            <span className="text-xs text-muted-slate">
              {draft.model.systemPrompt.trim() === '' ? t(locale, 'usingDefaultPrompt') : draft.model.systemPrompt === defaultPrompt ? t(locale, 'usingDefaultPrompt') : t(locale, 'usingCustomPrompt')}
            </span>
          </label>

          <div className="md:col-span-2 rounded-card border border-white/25 bg-white/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-cohere-black">{t(locale, 'knowledgeBaseExport')}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-slate">
                  {t(locale, 'knowledgeBaseDesc')}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-card border border-white/25 bg-white/50 px-3 py-3 text-sm">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-slate">{t(locale, 'repositoryPath')}</div>
              <div className="mt-2 break-words text-near-black font-mono text-xs">
                {draft.knowledgeBase.directoryPath || t(locale, 'notConfigured')}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void handleChooseDirectory()}
                className="inline-flex items-center gap-2 rounded-card-sm border border-white/30 bg-white/50 px-3 py-2 text-sm text-near-black transition-all duration-200 hover:bg-white/60"
                disabled={isImporting}
              >
                {isImporting ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                {isImporting ? t(locale, 'syncing') : t(locale, 'chooseDirectory')}
              </button>
            </div>
          </div>

          <div className="md:col-span-2 rounded-card border border-white/25 bg-white/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-cohere-black">{t(locale, 'explorationBehavior')}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-slate">
                  {t(locale, 'explorationDesc')}
                </p>
              </div>
            </div>

            <div className="mt-4 inline-flex items-center gap-0.5 rounded-card-sm bg-white/50 p-0.5 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, explorationMode: 'direct' }))}
                className={[
                  'inline-flex h-8 items-center justify-center gap-1.5 rounded-card-sm px-3 text-xs transition-colors',
                  (draft.explorationMode ?? 'direct') === 'direct'
                    ? 'bg-emerald-500/15 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.12)]'
                    : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                ].join(' ')}
              >
                <span className={[
                  'inline-block h-1.5 w-1.5 rounded-full',
                  (draft.explorationMode ?? 'direct') === 'direct' ? 'bg-emerald-500' : 'bg-muted-slate/40',
                ].join(' ')} />
                {t(locale, 'direct')}
              </button>
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, explorationMode: 'prompt' }))}
                className={[
                  'inline-flex h-8 items-center justify-center gap-1.5 rounded-card-sm px-3 text-xs transition-colors',
                  draft.explorationMode === 'prompt'
                    ? 'bg-emerald-500/15 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.12)]'
                    : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                ].join(' ')}
              >
                <span className={[
                  'inline-block h-1.5 w-1.5 rounded-full',
                  draft.explorationMode === 'prompt' ? 'bg-emerald-500' : 'bg-muted-slate/40',
                ].join(' ')} />
                {t(locale, 'prompt')}
              </button>
            </div>
          </div>

          <div className="md:col-span-2 rounded-card border border-white/25 bg-white/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-cohere-black">{t(locale, 'appearanceLanguage')}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-slate">
                  {t(locale, 'appearanceDesc')}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-xs text-muted-slate mb-2">{t(locale, 'theme')}</div>
                <div className="inline-flex items-center gap-0.5 rounded-card-sm bg-white/50 p-0.5 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => {
                      document.documentElement.dataset.theme = 'light'
                      setDraft((current) => ({ ...current, theme: 'light' }))
                    }}
                    className={[
                      'inline-flex h-8 items-center justify-center gap-1.5 rounded-card-sm px-3 text-xs transition-colors',
                      (draft.theme ?? 'light') === 'light'
                        ? 'bg-emerald-500/15 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.12)]'
                        : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                    ].join(' ')}
                  >
                    <span className={[
                      'inline-block h-1.5 w-1.5 rounded-full',
                      (draft.theme ?? 'light') === 'light' ? 'bg-emerald-500' : 'bg-muted-slate/40',
                    ].join(' ')} />
                    {t(locale, 'light')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      document.documentElement.dataset.theme = 'dark'
                      setDraft((current) => ({ ...current, theme: 'dark' }))
                    }}
                    className={[
                      'inline-flex h-8 items-center justify-center gap-1.5 rounded-card-sm px-3 text-xs transition-colors',
                      draft.theme === 'dark'
                        ? 'bg-emerald-500/15 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.12)]'
                        : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                    ].join(' ')}
                  >
                    <span className={[
                      'inline-block h-1.5 w-1.5 rounded-full',
                      draft.theme === 'dark' ? 'bg-emerald-500' : 'bg-muted-slate/40',
                    ].join(' ')} />
                    {t(locale, 'dark')}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-slate mb-2">{t(locale, 'language')}</div>
                <div className="inline-flex items-center gap-0.5 rounded-card-sm bg-white/50 p-0.5 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, locale: 'zh' }))}
                    className={[
                      'inline-flex h-8 items-center justify-center gap-1.5 rounded-card-sm px-3 text-xs transition-colors',
                      (draft.locale ?? 'zh') === 'zh'
                        ? 'bg-emerald-500/15 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.12)]'
                        : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                    ].join(' ')}
                  >
                    <span className={[
                      'inline-block h-1.5 w-1.5 rounded-full',
                      (draft.locale ?? 'zh') === 'zh' ? 'bg-emerald-500' : 'bg-muted-slate/40',
                    ].join(' ')} />
                    中文
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, locale: 'en' }))}
                    className={[
                      'inline-flex h-8 items-center justify-center gap-1.5 rounded-card-sm px-3 text-xs transition-colors',
                      draft.locale === 'en'
                        ? 'bg-emerald-500/15 text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.12)]'
                        : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                    ].join(' ')}
                  >
                    <span className={[
                      'inline-block h-1.5 w-1.5 rounded-full',
                      draft.locale === 'en' ? 'bg-emerald-500' : 'bg-muted-slate/40',
                    ].join(' ')} />
                    English
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div className="flex items-center justify-between border-t border-white/20 px-5 py-4">
          <div className="text-xs text-muted-slate">{t(locale, 'footerInfo')}</div>

          <button
            onClick={() => void updateSettings(draft)}
            className="inline-flex items-center gap-2 rounded-card bg-olive-accent px-4 py-2 text-sm font-semibold text-white transition-all duration-200 shadow-btn hover:shadow-btn-hover hover:bg-olive-accent/90 cursor-pointer"
          >
            <Save size={16} />
            {t(locale, 'save')}
          </button>
        </div>
      </div>
    </div>
  )
}
