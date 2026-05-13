import { useState } from 'react'
import { ArrowRight, FolderOpen, Loader2, Sparkles } from 'lucide-react'

import { useStore } from '../store'
import { getProjects, createProject as createProjectApi } from '../lib/api'
import { t } from '../lib/i18n'
import { isElectron, selectDirectoryElectron } from '../lib/electronFS'
import { updateRepositorySettings } from '../lib/api'

export default function WelcomeOverlay() {
  const locale = useStore(s => s.settings.locale ?? 'zh')
  const { setNotice, setCurrentProject, setProjects, settings, setSettings, importFromRepository } = useStore()
  const [isLoading, setIsLoading] = useState(false)
  const [isSelectingDirectory, setIsSelectingDirectory] = useState(false)

  const handleStartExploring = async () => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const projects = await getProjects()
      if (projects.length > 0) {
        setProjects(projects)
        setCurrentProject(projects[0])
        setNotice(t(locale, 'loadedProjects', projects.length))
      } else {
        const newProject = await createProjectApi('Untitled Project')
        setProjects([newProject])
        setCurrentProject(newProject)
        setNotice(t(locale, 'createdNewProject'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t(locale, 'failedToLoadProjects')
      setNotice(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleChooseDirectory = async () => {
    if (isSelectingDirectory) return
    setIsSelectingDirectory(true)
    
    if (isElectron()) {
      try {
        const dirPath = await selectDirectoryElectron()
        if (dirPath) {
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
          await importFromRepository()
          setNotice(t(locale, 'kbConfigured'))
        }
      } catch (error) {
        setNotice(t(locale, 'dirSelectFailed'))
      } finally {
        setIsSelectingDirectory(false)
      }
    } else {
      const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      if (!picker) {
        setNotice(t(locale, 'browserNotSupported'))
        setIsSelectingDirectory(false)
        return
      }

      try {
        const handle = await picker()
        const newSettings = {
          ...settings,
          knowledgeBase: {
            ...settings.knowledgeBase,
            directoryName: handle.name,
            directoryHandle: handle,
          },
        }
        setSettings(newSettings)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setIsSelectingDirectory(false)
          return
        }
        setNotice(t(locale, 'dirSelectFailed'))
      } finally {
        setIsSelectingDirectory(false)
      }
    }
  }

  const needsSetup = !settings.knowledgeBase.directoryPath

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-white to-[#f7f7f8]">
      <div className="flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Sparkles size={40} className="text-olive-accent" />
            <h1 className="font-display text-6xl tracking-[-0.04em] text-cohere-black">KnoPath</h1>
          </div>
          <p className="text-sm uppercase tracking-[0.28em] text-muted-slate">{t(locale, 'branchingKnowledgeWorkspace')}</p>
        </div>

        {needsSetup ? (
          <div className="flex flex-col items-center gap-5">
            <div className="max-w-md text-center">
              <p className="text-sm text-muted-slate">
                {t(locale, 'setupKbFirst')}
              </p>
            </div>
            <button
              onClick={() => void handleChooseDirectory()}
              disabled={isSelectingDirectory}
              className={[
                'inline-flex items-center gap-2 rounded-[14px] bg-olive-accent px-8 py-4 text-base font-medium text-white transition-all',
                !isSelectingDirectory
                  ? 'hover:bg-olive-accent-hover shadow-[0_8px_24px_rgba(59,130,246,0.25)]'
                  : 'cursor-not-allowed opacity-50',
              ].join(' ')}
            >
              {isSelectingDirectory ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {t(locale, 'settingUp')}
                </>
              ) : (
                <>
                  <FolderOpen size={18} />
                  {t(locale, 'chooseKbDirectory')}
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            <button
              onClick={() => void handleStartExploring()}
              disabled={isLoading}
              className={[
                'inline-flex items-center gap-2 rounded-[14px] bg-olive-accent px-8 py-4 text-base font-medium text-white transition-all',
                !isLoading
                  ? 'hover:bg-olive-accent-hover shadow-[0_8px_24px_rgba(59,130,246,0.25)]'
                  : 'cursor-not-allowed opacity-50',
              ].join(' ')}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {t(locale, 'loading')}
                </>
              ) : (
                <>
                  {t(locale, 'startExploring')}
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            <p className="text-sm text-muted-slate">{t(locale, 'clickToStartExploring')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
