import type { KnoPathNode, KnoPathNodeData, Project } from '../types'

interface ImportedNodeData {
  question: string
  answer: string
  summary: string
  context: string
  filePath: string
}

interface ImportedProject {
  projectName: string
  nodes: ImportedNodeData[]
}

interface MarkdownFile {
  name: string
  path: string
  content: string
}

async function readMarkdownFilesInDirectory(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<MarkdownFile[]> {
  const files: MarkdownFile[] = []
  const entries = (directoryHandle as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterable<[string, FileSystemHandle]>
  }).entries

  if (!entries) {
    return files
  }

  for await (const [name, handle] of entries.call(directoryHandle)) {
    if (handle.kind === 'file' && name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      const content = await file.text()
      files.push({ name, path: name, content })
    }
  }

  return files
}

async function readProjectDirectories(
  wikiHandle: FileSystemDirectoryHandle,
): Promise<Map<string, FileSystemDirectoryHandle>> {
  const projectDirs = new Map<string, FileSystemDirectoryHandle>()
  const entries = (wikiHandle as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterable<[string, FileSystemHandle]>
  }).entries

  if (!entries) {
    return projectDirs
  }

  for await (const [name, handle] of entries.call(wikiHandle)) {
    if (handle.kind === 'directory') {
      projectDirs.set(name, handle as FileSystemDirectoryHandle)
    }
  }

  return projectDirs
}

function parseMarkdownFile(file: MarkdownFile): ImportedNodeData | null {
  const { content, path: filePath } = file

  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  let body = content

  if (frontMatterMatch) {
    body = frontMatterMatch[2]
  }

  const titleMatch = body.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.md$/, '')

  const coreConclusionMatch = body.match(/\*\*Core conclusion\*\*:\s*(.+)/i)
  const summary = coreConclusionMatch ? coreConclusionMatch[1].trim() : ''

  const sections = body.split(/^##\s+/m)
  let answer = ''
  let context = ''

  for (const section of sections) {
    const lines = section.split('\n')
    const sectionTitle = lines[0]?.trim().toLowerCase() || ''

    if (sectionTitle.includes('detailed content') || sectionTitle.includes('content')) {
      answer = lines.slice(1).join('\n').trim()
    } else if (sectionTitle.includes('context')) {
      context = lines.slice(1).join('\n').trim()
    }
  }

  if (!answer && body.length > 0) {
    const lines = body.split('\n')
    const contentLines: string[] = []
    let inContent = false

    for (const line of lines) {
      if (line.startsWith('# ')) {
        inContent = true
        continue
      }
      if (line.startsWith('## ')) {
        inContent = false
      }
      if (inContent && line.trim()) {
        contentLines.push(line)
      }
    }

    if (contentLines.length > 0) {
      answer = contentLines.join('\n').trim()
    }
  }

  if (!answer && !summary) {
    return null
  }

  return {
    question: title,
    answer: answer || summary,
    summary: summary || title,
    context: context || '',
    filePath,
  }
}

export async function importFromRepository(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<ImportedProject[]> {
  const permissionRequest = (directoryHandle as FileSystemDirectoryHandle & {
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }).requestPermission
  const permission = permissionRequest ? await permissionRequest.call(directoryHandle, { mode: 'read' }) : 'granted'
  if (permission !== 'granted') {
    throw new Error('KnoPath needs read permission for the selected knowledge base directory.')
  }

  let wikiHandle: FileSystemDirectoryHandle
  try {
    wikiHandle = await directoryHandle.getDirectoryHandle('wiki', { create: false })
  } catch {
    return []
  }

  const projectDirs = await readProjectDirectories(wikiHandle)
  const importedProjects: ImportedProject[] = []

  for (const [projectName, projectHandle] of projectDirs) {
    const files = await readMarkdownFilesInDirectory(projectHandle)
    const nodes: ImportedNodeData[] = []

    for (const file of files) {
      const parsed = parseMarkdownFile(file)
      if (parsed) {
        nodes.push(parsed)
      }
    }

    if (nodes.length > 0) {
      importedProjects.push({ projectName, nodes })
    }
  }

  return importedProjects
}

export function createNodeFromImportedData(
  importedData: ImportedNodeData,
  parentId: string | null = null,
): KnoPathNode {
  const now = new Date().toISOString()
  
  const date = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  const timestamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  const safeTitle = importedData.question.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').slice(0, 30)
  const nodeId = `${timestamp}-${safeTitle}`
  
  const nodeData: KnoPathNodeData = {
    parentId,
    type: parentId ? 'branch' : 'root',
    question: importedData.question,
    answer: importedData.answer,
    summary: importedData.summary,
    context: importedData.context,
    isMarked: false,
    isBranchCollapsed: false,
    isNodeCollapsed: false,
    createdAt: now,
    updatedAt: now,
    childrenCount: 0,
    insightUpdatedAt: now,
  }

  return {
    id: nodeId,
    type: 'knopath',
    position: { x: 96, y: 120 },
    width: 290,
    height: 380,
    data: nodeData,
  }
}

export function createProjectFromImported(
  importedProject: ImportedProject,
  existingProjects: Project[],
): Project {
  const now = new Date().toISOString()
  const nodes: KnoPathNode[] = importedProject.nodes.map((data) => createNodeFromImportedData(data, null))

  let baseTitle = importedProject.projectName
  let finalTitle = baseTitle
  let counter = 1

  const existingTitles = new Set(existingProjects.map((p) => p.title))
  while (existingTitles.has(finalTitle)) {
    finalTitle = `${baseTitle} (${counter})`
    counter++
  }

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}`,
    title: finalTitle,
    nodes,
    edges: [],
    createdAt: now,
    updatedAt: now,
    nodeCount: nodes.length,
    isFavorite: false,
  }
}
