import { useEffect } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { ReactFlowProvider } from '@xyflow/react'
import { useStore } from './store'
import Toolbar from './components/Toolbar'
import LeftPanel from './components/LeftPanel'
import Canvas from './components/Canvas'
import BottomPanel from './components/BottomPanel'
import WelcomeOverlay from './components/WelcomeOverlay'
import SettingsModal from './components/SettingsModal'
import NodeDetailPanel from './components/NodeDetailPanel'
import ParentNodePanel from './components/ParentNodePanel'
import InsightWorkspace from './components/InsightWorkspace'
import TitleBar from './components/TitleBar'
import BackendLoading from './components/BackendLoading'
import { WORKSPACE_CHROME_LAYOUT } from './lib/workspaceChromeLayout'
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts'
import { useWebSocket } from './lib/useWebSocket'
import { useBackendStatus } from './lib/useBackendStatus'

function App() {
  const { loadProjects, loadSettings, validateAndLoadRepository, currentProject, currentWorkspace, rightPanelOpen, bottomPanelOpen, toggleRightPanel, settings } = useStore()
  const { isReady, isChecking, error, retryCount, retry } = useBackendStatus()

  useKeyboardShortcuts()
  useWebSocket()

  useEffect(() => {
    if (isReady) {
      validateAndLoadRepository()
      loadProjects()
      loadSettings()
    }
  }, [loadProjects, loadSettings, validateAndLoadRepository, isReady])

  useEffect(() => {
    const theme = settings.theme ?? 'light'
    document.documentElement.dataset.theme = theme
  }, [settings.theme])

  if (!isReady) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
        <TitleBar />
        <div className="flex-1 overflow-hidden">
          <BackendLoading 
            isChecking={isChecking} 
            error={error} 
            retryCount={retryCount}
            onRetry={retry}
          />
        </div>
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
        <TitleBar />
        <div className="flex-1 overflow-hidden">
          <WelcomeOverlay />
        </div>
        <SettingsModal />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
      <TitleBar />
      <Toolbar />

      {currentWorkspace === 'explore' ? (
        <>
          <div className="relative flex flex-1 overflow-hidden" style={{
            background: [
              'radial-gradient(ellipse 70% 50% at 15% 25%, var(--canvas-glow-olive) 0%, transparent 60%)',
              'radial-gradient(ellipse 55% 45% at 85% 75%, var(--canvas-glow-blue) 0%, transparent 55%)',
              'radial-gradient(ellipse 50% 40% at 50% 90%, var(--canvas-glow-warm) 0%, transparent 50%)',
              'radial-gradient(ellipse 120% 100% at 50% 50%, var(--canvas-bg) 0%, var(--canvas-bg-deep) 100%)',
            ].join(', '),
          }}>
            <LeftPanel />

            <main className="relative flex-1 overflow-hidden">
              <div className="flex h-full">
                <div className="relative flex-1 overflow-hidden">
                  <ReactFlowProvider>
                    <Canvas />
                  </ReactFlowProvider>
                  <ParentNodePanel />
                  <button
                    onClick={toggleRightPanel}
                    className={[
                      WORKSPACE_CHROME_LAYOUT.iconButtonClassName,
                      'absolute right-4 top-4 z-20 bg-white/65 shadow-[0_12px_32px_rgba(23,23,28,0.08)] backdrop-blur-xl',
                    ].join(' ')}
                    title={rightPanelOpen ? 'Hide details panel' : 'Show details panel'}
                  >
                    {rightPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                  </button>
                </div>
                {rightPanelOpen ? <NodeDetailPanel /> : null}
              </div>
            </main>
          </div>

          {bottomPanelOpen ? <BottomPanel /> : null}
        </>
      ) : (
        <InsightWorkspace />
      )}
      <SettingsModal />
    </div>
  )
}

export default App
