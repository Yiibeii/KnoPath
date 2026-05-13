import { useState, useEffect } from 'react'
import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { isElectron } from '../lib/electronFS'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (isElectron() && window.electronAPI?.windowIsMaximized) {
      window.electronAPI.windowIsMaximized().then(setIsMaximized)
    }
  }, [])

  if (!isElectron()) return null

  const handleMinimize = async () => {
    await window.electronAPI?.windowMinimize?.()
  }

  const handleMaximize = async () => {
    await window.electronAPI?.windowMaximize?.()
    const maximized = await window.electronAPI?.windowIsMaximized?.()
    setIsMaximized(maximized ?? false)
  }

  const handleClose = async () => {
    await window.electronAPI?.windowClose?.()
  }

  return (
    <div
      className="h-8 flex items-center justify-between border-b border-white/20 select-none"
      style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center px-3 gap-2">
        <span className="text-[11px] uppercase tracking-[0.24em] text-muted-slate">KnoPath</span>
      </div>
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={handleMinimize}
          className="w-11 h-8 flex items-center justify-center text-muted-slate hover:text-cohere-black hover:bg-white/50 transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-8 flex items-center justify-center text-muted-slate hover:text-cohere-black hover:bg-white/50 transition-colors"
        >
          {isMaximized ? <Maximize2 size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={handleClose}
          className="w-11 h-8 flex items-center justify-center text-muted-slate hover:text-white hover:bg-red-500 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
