import type { KnoPathNode, KnoPathNodeData } from '../types'

interface MarkdownFile {
  name: string
  path: string
  content: string
  nodeId?: string
  parentId?: string | null
}

interface SyncedProject {
  projectName: string
  nodes: MarkdownFile[]
}

async function readDirectoryRecursive(
  directoryHandle: FileSystemDirectoryHandle,
  basePath: string = ''
): Promise<MarkdownFile[]> {
  const files: MarkdownFile[] = []
  const entries = (directoryHandle as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterable<[string, FileSystemHandle]>
  }).entries

  if (!entries) {
    return files
  }

  for await (const [name, handle] of entries.call(directoryHandle)) {
    const currentPath = basePath ? `${basePath}/${name}` : name
    
    if (handle.kind === 'file' && name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      const content = await file.text()
      const { nodeId, parentId } = parseFrontMatter(content)
      files.push({ 
        name, 
        path: currentPath, 
        content, 
        nodeId,
        parentId 
      })
    } else if (handle.kind === 'directory') {
      const subFiles = await readDirectoryRecursive(
        handle as FileSystemDirectoryHandle, 
        currentPath
      )
      files.push(...subFiles)
    }
  }

  return files
}

function parseFrontMatter(content: string): { nodeId?: string; parentId?: string | null } {
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontMatterMatch) return {}
  
  const frontMatter = frontMatterMatch[1]
  const idMatch = frontMatter.match(/^id:\s*(.+)$/m)
  const parentIdMatch = frontMatter.match(/^parent_id:\s*(.+)$/m)
  
  let parentId: string | null | undefined = undefined
  if (parentIdMatch) {
    const value = parentIdMatch[1].trim()
    parentId = value === 'None' || value === 'null' ? null : value
  }
  
  return {
    nodeId: idMatch ? idMatch[1].trim() : undefined,
    parentId
  }
}

function parseMarkdownContent(content: string): {
  question: string
  answer: string
  summary: string
  context: string
} {
  const frontMatterMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  const body = frontMatterMatch ? frontMatterMatch[1] : content

  const titleMatch = body.match(/^#\s+(.+)$/m)
  const question = titleMatch ? titleMatch[1].trim() : ''

  const sections: Record<string, string> = {}
  const sectionRegex = /^##\s+(.+)\n([\s\S]*?)(?=^##\s|$)/gm
  let match
  while ((match = sectionRegex.exec(body)) !== null) {
    const sectionTitle = match[1].trim().toLowerCase()
    const sectionContent = match[2].trim()
    sections[sectionTitle] = sectionContent
  }

  return {
    question,
    answer: sections['answer'] || sections['content'] || '',
    summary: sections['summary'] || '',
    context: sections['context'] || ''
  }
}

export async function syncFromRepository(
  directoryHandle: FileSystemDirectoryHandle
): Promise<SyncedProject[]> {
  const permissionRequest = (directoryHandle as FileSystemDirectoryHandle & {
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }).requestPermission
  const permission = permissionRequest 
    ? await permissionRequest.call(directoryHandle, { mode: 'readwrite' }) 
    : 'granted'
  if (permission !== 'granted') {
    throw new Error('Read-write permission required to sync repository')
  }

  const projects: SyncedProject[] = []

  const rawHandle = await tryGetDirectory(directoryHandle, 'raw')
  if (rawHandle) {
    const rawFiles = await readDirectoryRecursive(rawHandle, 'raw')
    const projectMap = new Map<string, MarkdownFile[]>()
    
    for (const file of rawFiles) {
      const pathParts = file.path.split('/')
      if (pathParts.length >= 2) {
        const projectName = pathParts[1]
        if (!projectMap.has(projectName)) {
          projectMap.set(projectName, [])
        }
        projectMap.get(projectName)!.push(file)
      }
    }
    
    for (const [projectName, files] of projectMap) {
      projects.push({ projectName, nodes: files })
    }
  }

  const wikiHandle = await tryGetDirectory(directoryHandle, 'wiki')
  if (wikiHandle) {
    const wikiFiles = await readDirectoryRecursive(wikiHandle, 'wiki')
    const projectMap = new Map<string, MarkdownFile[]>()
    
    for (const file of wikiFiles) {
      const pathParts = file.path.split('/')
      if (pathParts.length >= 2) {
        const projectName = pathParts[1]
        if (!projectMap.has(projectName)) {
          projectMap.set(projectName, [])
        }
        projectMap.get(projectName)!.push(file)
      }
    }
    
    for (const [projectName, files] of projectMap) {
      const existing = projects.find(p => p.projectName === projectName)
      if (existing) {
        existing.nodes.push(...files)
      } else {
        projects.push({ projectName, nodes: files })
      }
    }
  }

  return projects
}

async function tryGetDirectory(
  parent: FileSystemDirectoryHandle, 
  name: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create: false })
  } catch {
    return null
  }
}

export function createNodeFromMarkdown(
  file: MarkdownFile,
  position: { x: number; y: number } = { x: 96, y: 120 }
): KnoPathNode {
  const now = new Date().toISOString()
  const parsed = parseMarkdownContent(file.content)
  
  const nodeId = file.nodeId || file.name.replace(/\.md$/, '')
  
  const nodeData: KnoPathNodeData = {
    parentId: file.parentId ?? null,
    type: file.parentId ? 'branch' : 'root',
    question: parsed.question || file.name.replace(/\.md$/, ''),
    answer: parsed.answer,
    summary: parsed.summary,
    context: parsed.context,
    isMarked: false,
    isBranchCollapsed: false,
    isNodeCollapsed: false,
    createdAt: now,
    updatedAt: now,
    childrenCount: 0,
  }

  return {
    id: nodeId,
    type: 'knopath',
    position,
    width: 290,
    height: 380,
    data: nodeData,
  }
}

export async function writeMarkdownFile(
  directoryHandle: FileSystemDirectoryHandle,
  projectName: string,
  node: KnoPathNode
): Promise<void> {
  const rawHandle = await directoryHandle.getDirectoryHandle('raw', { create: true })
  const projectHandle = await rawHandle.getDirectoryHandle(projectName, { create: true })
  
  const filename = `${node.id}.md`
  
  const content = buildMarkdownContent(node)
  
  const fileHandle = await projectHandle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

function buildMarkdownContent(node: KnoPathNode): string {
  const data = node.data
  return `---
id: ${node.id}
parent_id: ${data.parentId || 'None'}
created: ${data.createdAt || new Date().toISOString()}
updated: ${data.updatedAt || new Date().toISOString()}
---

# ${data.question || 'Untitled Node'}

## Question
${data.question || 'No question'}

## Answer
${data.answer || 'No answer yet'}

## Summary
${data.summary || 'No summary yet'}

## Context
${data.context || 'No context'}
`
}
