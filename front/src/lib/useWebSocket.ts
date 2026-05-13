import { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from '../store'

const WS_URL = 'ws://localhost:8000/api/v1/ws'

interface NodeUpdatedMessage {
  type: 'node_updated'
  projectId: string
  nodeId: string
  projectName: string
}

interface NodeDeletedMessage {
  type: 'node_deleted'
  projectId: string
  nodeId: string
  nodeIds?: string[]
  projectName: string
}

interface WikiSyncedMessage {
  type: 'wiki_synced'
}

interface PongMessage {
  type: 'pong'
}

type WebSocketMessage = NodeUpdatedMessage | NodeDeletedMessage | WikiSyncedMessage | PongMessage | { type: string; [key: string]: unknown }

function isNodeUpdatedMessage(msg: WebSocketMessage): msg is NodeUpdatedMessage {
  return msg.type === 'node_updated' && typeof (msg as NodeUpdatedMessage).projectId === 'string' && typeof (msg as NodeUpdatedMessage).nodeId === 'string'
}

function isNodeDeletedMessage(msg: WebSocketMessage): msg is NodeDeletedMessage {
  return msg.type === 'node_deleted' && typeof (msg as NodeDeletedMessage).projectId === 'string' && typeof (msg as NodeDeletedMessage).nodeId === 'string'
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const [isConnected, setIsConnected] = useState(false)
  const { 
    currentProject, 
    setCurrentProject, 
    projects, 
    setProjects,
    setNotice,
    loadWikiGraph,
  } = useStore()

  const handleNodeUpdated = useCallback((message: NodeUpdatedMessage) => {
    if (currentProject?.id === message.projectId) {
      setNotice(`Node updated: ${message.nodeId}`)
    }
  }, [currentProject, setNotice])

  const handleNodeDeleted = useCallback((message: NodeDeletedMessage) => {
    const deletedIds = message.nodeIds || [message.nodeId]
    
    if (currentProject?.id === message.projectId) {
      const updatedNodes = currentProject.nodes.filter(n => !deletedIds.includes(n.id))
      setCurrentProject({
        ...currentProject,
        nodes: updatedNodes,
        nodeCount: updatedNodes.length,
      })
      setNotice(`Deleted ${deletedIds.length} node(s)`)
    }

    const updatedProjects = projects.map(p => {
      if (p.id === message.projectId) {
        const filteredNodes = p.nodes.filter(n => !deletedIds.includes(n.id))
        return {
          ...p,
          nodes: filteredNodes,
          nodeCount: filteredNodes.length,
        }
      }
      return p
    })
    setProjects(updatedProjects)
  }, [currentProject, projects, setCurrentProject, setProjects, setNotice])

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'node_updated':
        if (isNodeUpdatedMessage(message)) handleNodeUpdated(message)
        break
      case 'node_deleted':
        if (isNodeDeletedMessage(message)) handleNodeDeleted(message)
        break
      case 'wiki_synced':
        void loadWikiGraph()
        break
      case 'pong':
        break
    }
  }, [handleNodeUpdated, handleNodeDeleted, loadWikiGraph])

  const messageHandlerRef = useRef(handleWebSocketMessage)
  messageHandlerRef.current = handleWebSocketMessage

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    if (typeof WebSocket === 'undefined') {
      return
    }

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        reconnectAttemptsRef.current = 0
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          messageHandlerRef.current(message)
        } catch {
          // Skip invalid JSON
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
        reconnectAttemptsRef.current++
        
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect()
        }, delay)
      }

      ws.onerror = () => {
        // Error handling is done in onclose
      }
    } catch {
      // Failed to create WebSocket
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      connect()
    }, 1000)

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      clearTimeout(timer)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      clearInterval(pingInterval)
      wsRef.current?.close()
    }
  }, [connect])

  return {
    isConnected,
  }
}
