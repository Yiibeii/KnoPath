import { Loader2, Server, AlertCircle, RefreshCw } from 'lucide-react'
import { Sparkles } from 'lucide-react'

import { t } from '../lib/i18n'
import { useStore } from '../store'

interface BackendLoadingProps {
  isChecking: boolean
  error: string | null
  retryCount: number
  onRetry: () => void
}

export default function BackendLoading({ isChecking, error, retryCount, onRetry }: BackendLoadingProps) {
  const locale = useStore(s => s.settings.locale ?? 'zh')

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

        <div className="flex flex-col items-center gap-5">
          {error ? (
            <div className="flex flex-col items-center gap-4 max-w-md">
              <div className="flex items-center gap-2 text-red-500">
                <AlertCircle size={24} />
                <span className="text-lg font-medium">{t(locale, 'backendConnectionFailed')}</span>
              </div>
              <p className="text-sm text-muted-slate text-center">{error}</p>
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-lg bg-olive-accent px-4 py-2 text-sm text-white hover:bg-olive-accent/90 transition-colors"
              >
                <RefreshCw size={16} />
                {t(locale, 'retryConnection')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3 text-muted-slate">
                {isChecking ? (
                  <Loader2 size={24} className="animate-spin text-olive-accent" />
                ) : (
                  <Server size={24} className="text-olive-accent" />
                )}
                <span className="text-base">
                  {isChecking ? t(locale, 'connectingToBackend') : t(locale, 'startingBackend')}
                </span>
              </div>
              {retryCount > 0 && (
                <p className="text-xs text-muted-slate">
                  {t(locale, 'attemptOf', retryCount + 1)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
