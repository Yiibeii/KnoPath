import { useState, useRef } from 'react'
import {
  BookOpenText,
  Download,
  FileText,
  FileStack,
  ListTree,
  Link2,
  Orbit,
  RefreshCw,
  Share2,
  Upload,
  X,
} from 'lucide-react'

import { downloadMarkdown } from '../lib/export'
import { importProjectsFromFiles, importWikiPagesFromFiles, importProjectFromJson } from '../lib/api'
import { generatePngDataUrl } from '../lib/imageExport'
import { canToggleInsightLinks } from '../lib/insightTemplateView'
import { WORKSPACE_CHROME_LAYOUT } from '../lib/workspaceChromeLayout'
import { t } from '../lib/i18n'
import { useStore } from '../store'

export default function Toolbar() {
  const {
    currentProject,
    currentWorkspace,
    setWorkspace,
    toggleInsightLinks,
    toggleInsightOutline,
    toggleInsightTemplates,
    setNotice,
    insightLinksOpen,
    insightOutlineOpen,
    insightTemplatesOpen,
    insightGraphOpen,
    toggleInsightGraph,
  } = useStore()
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const [isExportingPng, setIsExportingPng] = useState(false)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadProjects = useStore((state) => state.loadProjects)
  const selectProject = useStore((state) => state.selectProject)
  const sourceLinksEnabled = canToggleInsightLinks(insightTemplatesOpen, insightGraphOpen)

  const handleExportPng = async () => {
    if (!currentProject) return
    setIsExportingPng(true)
    try {
      const dataUrl = await generatePngDataUrl(currentProject)
      const anchor = document.createElement('a')
      anchor.href = dataUrl
      anchor.download = `${currentProject.title}.png`
      anchor.click()
      setNotice(t(locale, 'canvasExported'))
    } finally {
      setIsExportingPng(false)
      setDownloadModalOpen(false)
    }
  }

  const handleExportMarkdown = async () => {
    if (!currentProject) return
    downloadMarkdown(currentProject, useStore.getState().markedNodes)
    setNotice(t(locale, 'markdownExported'))
    setDownloadModalOpen(false)
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const projects = await importProjectsFromFiles()
      const wikiGraph = await importWikiPagesFromFiles()
      await loadProjects()
      if (currentProject) {
        const updatedProject = projects.find(p => p.id === currentProject.id)
        if (updatedProject) {
          await selectProject(updatedProject.id)
        }
      }
      setNotice(t(locale, 'syncComplete', projects.length, wikiGraph.pages.length))
    } catch (error) {
      const message = error instanceof Error ? error.message : t(locale, 'syncFailed')
      setNotice(message)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()
      let jsonData: unknown[]
      try {
        const parsed = JSON.parse(text)
        jsonData = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        setNotice(t(locale, 'invalidJsonFile'))
        return
      }

      if (jsonData.length === 0) {
        setNotice(t(locale, 'emptyJsonFile'))
        return
      }

      const title = file.name.replace(/\.json$/i, '')
      const project = await importProjectFromJson(title, jsonData)
      await loadProjects()
      await selectProject(project.id)
      setNotice(t(locale, 'jsonImported', project.nodeCount))
    } catch (error) {
      const message = error instanceof Error ? error.message : t(locale, 'jsonImportFailed')
      setNotice(message)
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <>
      <header className={WORKSPACE_CHROME_LAYOUT.toolbarHeaderClassName}>
        <div className={WORKSPACE_CHROME_LAYOUT.toolbarLeadClassName}>
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">{t(locale, 'branchingWorkspace')}</div>
            <span className="font-display text-[24px] leading-none tracking-[-0.03em] text-cohere-black">KnoPath</span>
          </div>

          <div className={WORKSPACE_CHROME_LAYOUT.toolbarSegmentGroupClassName}>
            <button
              onClick={() => setWorkspace('explore')}
              className={[
                WORKSPACE_CHROME_LAYOUT.toolbarSegmentButtonClassName,
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
                WORKSPACE_CHROME_LAYOUT.toolbarSegmentButtonClassName,
                currentWorkspace === 'insight'
                  ? 'bg-white/60 text-cohere-black shadow-[0_8px_18px_rgba(23,23,28,0.08)]'
                  : 'text-muted-slate hover:text-cohere-black',
              ].join(' ')}
            >
              <BookOpenText size={15} />
              {t(locale, 'insight')}
            </button>
          </div>

          <div className="h-8 w-px bg-border-cool" />
        </div>

        {currentWorkspace === 'explore' ? (
          <div className={WORKSPACE_CHROME_LAYOUT.toolbarToolsWrapClassName}>
            <div className={WORKSPACE_CHROME_LAYOUT.toolbarUtilityGroupClassName}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={(e) => void handleImportJson(e)}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className={WORKSPACE_CHROME_LAYOUT.toolbarUtilityButtonClassName}
                title={t(locale, 'importJson')}
              >
                {isImporting ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />}
                <span>{t(locale, 'importJson')}</span>
              </button>

              {currentProject && (
                <>
                  <button
                    onClick={() => void handleSync()}
                    disabled={isSyncing}
                    className={WORKSPACE_CHROME_LAYOUT.toolbarUtilityButtonClassName}
                    title={t(locale, 'syncWithFiles')}
                  >
                    {isSyncing ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    <span>{t(locale, 'sync')}</span>
                  </button>

                  <button
                    onClick={() => setDownloadModalOpen(true)}
                    className={WORKSPACE_CHROME_LAYOUT.toolbarUtilityButtonClassName}
                    title={t(locale, 'exportProject')}
                  >
                    {isExportingPng ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                    <span>{t(locale, 'export2')}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {currentWorkspace === 'insight' ? (
          <div className={WORKSPACE_CHROME_LAYOUT.toolbarToolsWrapClassName}>
            <div className={WORKSPACE_CHROME_LAYOUT.insightToolbarToggleGroupClassName}>
              <button
                onClick={toggleInsightTemplates}
                className={[
                  WORKSPACE_CHROME_LAYOUT.insightToolbarToggleButtonClassName,
                  insightTemplatesOpen ? 'bg-olive-accent/10 text-olive-accent' : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                ].join(' ')}
              >
                <FileStack size={15} />
                {t(locale, 'templates')}
              </button>
              <button
                onClick={toggleInsightGraph}
                className={[
                  WORKSPACE_CHROME_LAYOUT.insightToolbarToggleButtonClassName,
                  insightGraphOpen ? 'bg-olive-accent/10 text-olive-accent' : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                ].join(' ')}
              >
                <Share2 size={15} />
                {t(locale, 'graph')}
              </button>
              <button
                onClick={(insightTemplatesOpen || insightGraphOpen) ? undefined : toggleInsightOutline}
                disabled={insightTemplatesOpen || insightGraphOpen}
                className={[
                  WORKSPACE_CHROME_LAYOUT.insightToolbarToggleButtonClassName,
                  insightTemplatesOpen || insightGraphOpen
                    ? 'cursor-not-allowed bg-white/30 text-muted-slate/60'
                    : insightOutlineOpen
                      ? 'bg-olive-accent/10 text-olive-accent'
                      : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                ].join(' ')}
              >
                <ListTree size={15} />
                {t(locale, 'outline')}
              </button>
              <button
                onClick={sourceLinksEnabled ? toggleInsightLinks : undefined}
                disabled={!sourceLinksEnabled}
                className={[
                  WORKSPACE_CHROME_LAYOUT.insightToolbarToggleButtonClassName,
                  !sourceLinksEnabled
                    ? 'cursor-not-allowed bg-white/30 text-muted-slate/60'
                    : insightLinksOpen
                      ? 'bg-olive-accent/10 text-olive-accent'
                      : 'text-muted-slate hover:bg-white/50 hover:text-cohere-black',
                ].join(' ')}
              >
                <Link2 size={15} />
                {t(locale, 'sourceLinks')}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {downloadModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="relative w-[320px] rounded-card border border-white/30 bg-white/75 p-6 shadow-[0_18px_40px_rgba(23,23,28,0.15)] backdrop-blur-xl">
            <button
              onClick={() => setDownloadModalOpen(false)}
              className="absolute right-4 top-4 text-muted-slate transition-colors hover:text-cohere-black"
            >
              <X size={18} />
            </button>

            <h3 className="mb-4 font-display text-xl tracking-[-0.03em] text-cohere-black">{t(locale, 'download')}</h3>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => void handleExportMarkdown()}
                className="flex w-full items-center gap-3 rounded-card-sm border border-white/30 px-4 py-3 text-left text-sm text-near-black transition-colors hover:bg-white/50"
              >
                <FileText size={18} />
                <div>
                  <div className="font-medium">{t(locale, 'exportMarkdown')}</div>
                  <div className="text-xs text-muted-slate">{t(locale, 'downloadAsMd')}</div>
                </div>
              </button>
              <button
                onClick={() => void handleExportPng()}
                className="flex w-full items-center gap-3 rounded-card-sm border border-white/30 px-4 py-3 text-left text-sm text-near-black transition-colors hover:bg-white/50"
              >
                <Download size={18} />
                <div>
                  <div className="font-medium">{t(locale, 'exportPng')}</div>
                  <div className="text-xs text-muted-slate">{t(locale, 'downloadAsImage')}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
