import { useEffect, useState, useCallback } from 'react'

const API_BASE = 'http://localhost:8000/api/v1'
const HEALTH_CHECK_INTERVAL = 3000
const MAX_RETRIES = 10

export interface BackendStatus {
  isReady: boolean
  isChecking: boolean
  error: string | null
  retryCount: number
}

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>({
    isReady: false,
    isChecking: true,
    error: null,
    retryCount: 0,
  })

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      const response = await fetch(`${API_BASE}/health`, {
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        setStatus(prev => ({
          ...prev,
          isReady: true,
          isChecking: false,
          error: null,
        }))
        return true
      }
      return false
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus(prev => ({
          ...prev,
          error: 'Backend connection timeout',
        }))
      }
      return false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    let intervalId: number | null = null

    const performCheck = async () => {
      if (!mounted) return
      
      const success = await checkHealth()
      
      if (success && mounted) {
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      } else if (mounted) {
        setStatus(prev => {
          const newRetryCount = prev.retryCount + 1
          if (newRetryCount >= MAX_RETRIES) {
            return {
              ...prev,
              isChecking: false,
              error: 'Backend server is not responding. Please start the backend server.',
              retryCount: newRetryCount,
            }
          }
          return {
            ...prev,
            retryCount: newRetryCount,
          }
        })
      }
    }

    performCheck()

    intervalId = window.setInterval(() => {
      if (mounted && !status.isReady) {
        performCheck()
      }
    }, HEALTH_CHECK_INTERVAL)

    return () => {
      mounted = false
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [checkHealth, status.isReady])

  const retry = useCallback(() => {
    setStatus({
      isReady: false,
      isChecking: true,
      error: null,
      retryCount: 0,
    })
  }, [])

  return { ...status, retry }
}
