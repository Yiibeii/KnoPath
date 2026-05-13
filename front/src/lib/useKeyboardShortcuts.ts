import { useEffect } from 'react'

import { downloadMarkdown } from './export'
import { generatePngDataUrl } from './imageExport'
import { getKeyboardNavigationTarget } from './tree'
import { useStore } from '../store'

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export function useKeyboardShortcuts(): void {
  const {
    autoLayoutCurrentProject,
    createNode,
    currentProject,
    focusedNodeId,
    markedNodes,
    removeNode,
    saveCurrentProject,
    setFocusedNode,
    setNotice,
    settingsOpen,
    toggleBottomPanel,
    toggleNodeBranchCollapsed,
    toggleNodeMarked,
  } = useStore()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!currentProject) return

      const editable = isEditableElement(event.target)
      const normalizedKey = event.key.toLowerCase()
      const modifierPressed = event.metaKey || event.ctrlKey

      if (settingsOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          useStore.getState().setSettingsOpen(false)
        }
        return
      }

      if (editable && !(modifierPressed && normalizedKey === 'enter') && event.key !== 'Escape') {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        const activeElement = document.activeElement
        if (activeElement instanceof HTMLElement && isEditableElement(activeElement)) {
          activeElement.blur()
        }
        setFocusedNode(null)
        setNotice('Cleared node focus.')
        return
      }

      if (modifierPressed && normalizedKey === 'f') {
        event.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>('[data-shortcut-target="search-input"]')
        searchInput?.focus()
        searchInput?.select()
        return
      }

      if (modifierPressed && normalizedKey === 's') {
        return
      }

      if (modifierPressed && normalizedKey === 'l') {
        event.preventDefault()
        void autoLayoutCurrentProject()
        return
      }

      if (modifierPressed && event.shiftKey && normalizedKey === 'e') {
        event.preventDefault()
        downloadMarkdown(currentProject, markedNodes)
        setNotice('Markdown exported locally.')
        return
      }

      if (modifierPressed && event.shiftKey && normalizedKey === 'p') {
        event.preventDefault()
        void generatePngDataUrl(currentProject).then((dataUrl) => {
          const anchor = document.createElement('a')
          anchor.href = dataUrl
          anchor.download = `${currentProject.title}.png`
          anchor.click()
          useStore.getState().setNotice('Canvas PNG exported locally.')
        })
        return
      }

      if (modifierPressed && normalizedKey === 'enter') {
        event.preventDefault()
        const generateButton = document.querySelector<HTMLButtonElement>('[data-shortcut-target="generate-node"]')
        generateButton?.click()
        return
      }

      if (editable) return

      if (focusedNodeId && (normalizedKey === 'w' || normalizedKey === 'a' || normalizedKey === 's' || normalizedKey === 'd')) {
        event.preventDefault()
        const targetNodeId = getKeyboardNavigationTarget(currentProject, focusedNodeId, normalizedKey)
        if (targetNodeId) {
          setFocusedNode(targetNodeId)
        }
        return
      }

      if (normalizedKey === 'n') {
        event.preventDefault()
        void createNode(null, '')
        return
      }

      if (normalizedKey === 'b') {
        event.preventDefault()
        if (!focusedNodeId) {
          setNotice('Select a node first, then create a branch.')
          return
        }
        void createNode(focusedNodeId, '')
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (!focusedNodeId) {
          setNotice('Select a node first, then create a child node.')
          return
        }
        void createNode(focusedNodeId, '')
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        if (!focusedNodeId) {
          setNotice('Select a node first, then create a sibling node.')
          return
        }

        const focusedNode = currentProject.nodes.find((node) => node.id === focusedNodeId)
        void createNode(focusedNode?.data.parentId ?? null, '')
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        if (!focusedNodeId) return
        void toggleNodeBranchCollapsed(focusedNodeId)
        return
      }

      if (normalizedKey === 'm') {
        event.preventDefault()
        if (!focusedNodeId) return
        void toggleNodeMarked(focusedNodeId)
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (!focusedNodeId) return
        void removeNode(focusedNodeId)
        return
      }

      if (normalizedKey === 'o') {
        event.preventDefault()
        toggleBottomPanel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    autoLayoutCurrentProject,
    createNode,
    currentProject,
    focusedNodeId,
    markedNodes,
    removeNode,
    saveCurrentProject,
    setFocusedNode,
    setNotice,
    settingsOpen,
    toggleBottomPanel,
    toggleNodeBranchCollapsed,
    toggleNodeMarked,
  ])
}
