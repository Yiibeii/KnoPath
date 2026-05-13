import type { AppSettings, KnoPathNode, Project } from '../types'

interface InsightCompilationResult {
  rawFileName: string
  wikiFileName: string
  indexUpdated: boolean
}

interface BatchInsightCompilationResult {
  generatedCount: number
  rawFiles: string[]
  wikiFiles: string[]
  indexUpdated: boolean
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim()
  return cleaned.slice(0, 48) || 'Untitled-Insight'
}

function sanitizeProjectName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim()
  return cleaned.slice(0, 64) || 'Untitled-Project'
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

function buildBranchPath(nodeId: string, project: Project): string[] {
  const path: string[] = []
  let currentNode = project.nodes.find((candidate) => candidate.id === nodeId) ?? null

  while (currentNode) {
    path.unshift(currentNode.data.question || 'Untitled node')
    currentNode = currentNode.data.parentId
      ? (project.nodes.find((candidate) => candidate.id === currentNode?.data.parentId) ?? null)
      : null
  }

  return path
}

function buildRawContent(node: KnoPathNode, project: Project): string {
  const branchPath = buildBranchPath(node.id, project)
  const createdAt = node.data.updatedAt || new Date().toISOString()
  const title = node.data.question || 'Untitled node'

  return `---
id: ${formatTimestamp(new Date(createdAt))}-${sanitizeFileName(title)}
node_id: ${node.id}
project: ${project.title}
branch_path: ${JSON.stringify(branchPath)}
created: ${createdAt}
source: KnoPath
---

# ${title}

${node.data.answer || node.data.summary || 'Pending answer.'}

## Summary
${node.data.summary || 'No summary yet.'}

## Context
${node.data.context || 'No context snapshot yet.'}

---
Generated from KnoPath node ${node.id}
`
}

function buildWikiContent(node: KnoPathNode, rawRelativePath: string): string {
  const title = sanitizeFileName(node.data.summary || node.data.question || 'Untitled Insight')
  const coreConclusion = node.data.summary || node.data.answer || node.data.question || 'Pending conclusion.'

  return `# ${title}

> **Core conclusion**: ${coreConclusion}

## Detailed content
${node.data.answer || node.data.summary || 'Pending answer.'}

## Context
${node.data.context || 'No context snapshot yet.'}

## Source
> ${rawRelativePath}
`
}

function applyTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    template,
  )
}

async function ensureTextFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  contents: string,
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(contents)
  await writable.close()
}

async function listAllWikiFiles(directoryHandle: FileSystemDirectoryHandle): Promise<{ projectName: string; fileName: string }[]> {
  const files: { projectName: string; fileName: string }[] = []
  const entries = (directoryHandle as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterable<[string, FileSystemHandle]>
  }).entries

  if (!entries) {
    return files
  }

  for await (const [name, handle] of entries.call(directoryHandle)) {
    if (handle.kind === 'directory') {
      const projectHandle = handle as FileSystemDirectoryHandle
      const projectEntries = (projectHandle as FileSystemDirectoryHandle & {
        entries?: () => AsyncIterable<[string, FileSystemHandle]>
      }).entries

      if (projectEntries) {
        for await (const [fileName, fileHandle] of projectEntries.call(projectHandle)) {
          if (fileHandle.kind === 'file' && fileName.endsWith('.md')) {
            files.push({ projectName: name, fileName })
          }
        }
      }
    }
  }

  return files.sort((left, right) => {
    const projectCompare = left.projectName.localeCompare(right.projectName, 'zh-CN')
    if (projectCompare !== 0) return projectCompare
    return left.fileName.localeCompare(right.fileName, 'zh-CN')
  })
}

async function ensureVaultStructure(
  directoryHandle: FileSystemDirectoryHandle,
  settings: AppSettings,
): Promise<{
  rawHandle: FileSystemDirectoryHandle
  wikiHandle: FileSystemDirectoryHandle
}> {
  const rawHandle = await directoryHandle.getDirectoryHandle('raw', { create: true })
  const wikiHandle = await directoryHandle.getDirectoryHandle('wiki', { create: true })

  await ensureTextFile(directoryHandle, 'README.md', settings.knowledgeBase.templates.readme)
  await ensureTextFile(directoryHandle, 'CLAUDE.md', settings.knowledgeBase.templates.claude)

  return { rawHandle, wikiHandle }
}

export async function compileNodeInsight(
  node: KnoPathNode,
  project: Project,
  rootDirectoryHandle: FileSystemDirectoryHandle,
  settings: AppSettings,
): Promise<InsightCompilationResult> {
  const result = await compileMarkedInsights([node], project, rootDirectoryHandle, settings)
  return {
    rawFileName: result.rawFiles[0],
    wikiFileName: result.wikiFiles[0],
    indexUpdated: result.indexUpdated,
  }
}

export async function compileMarkedInsights(
  nodes: KnoPathNode[],
  project: Project,
  rootDirectoryHandle: FileSystemDirectoryHandle,
  settings: AppSettings,
): Promise<BatchInsightCompilationResult> {
  const permissionRequest = (rootDirectoryHandle as FileSystemDirectoryHandle & {
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }).requestPermission
  const permission = permissionRequest ? await permissionRequest.call(rootDirectoryHandle, { mode: 'readwrite' }) : 'granted'
  if (permission !== 'granted') {
    throw new Error('KnoPath needs read and write permission for the selected knowledge base directory.')
  }

  const { rawHandle, wikiHandle } = await ensureVaultStructure(rootDirectoryHandle, settings)

  const projectDirName = sanitizeProjectName(project.title)
  const projectRawHandle = await rawHandle.getDirectoryHandle(projectDirName, { create: true })
  const projectWikiHandle = await wikiHandle.getDirectoryHandle(projectDirName, { create: true })

  const rawFiles: string[] = []
  const wikiFilesWritten: string[] = []

  for (const node of nodes) {
    const timestamp = formatTimestamp()
    const rawFileName = `${timestamp}-${sanitizeFileName(node.data.question || 'insight')}.md`
    const wikiFileName = `${sanitizeFileName(node.data.summary || node.data.question || 'insight')}.md`

    await ensureTextFile(projectRawHandle, rawFileName, buildRawContent(node, project))
    await ensureTextFile(projectWikiHandle, wikiFileName, buildWikiContent(node, `raw/${projectDirName}/${rawFileName}`))

    rawFiles.push(rawFileName)
    wikiFilesWritten.push(wikiFileName)
  }

  const allWikiFiles = await listAllWikiFiles(wikiHandle)
  const indexContent = applyTemplate(settings.knowledgeBase.templates.index, {
    updatedAt: new Date().toISOString(),
    wikiLinks: allWikiFiles.map(({ projectName, fileName }) => `- [[${projectName}/${fileName.replace(/\.md$/, '')}]]`).join('\n') || '- None yet',
    count: String(nodes.length),
    plural: nodes.length === 1 ? '' : 's',
  })
  await ensureTextFile(rootDirectoryHandle, 'index.md', indexContent)

  return {
    generatedCount: nodes.length,
    rawFiles,
    wikiFiles: wikiFilesWritten,
    indexUpdated: true,
  }
}

export async function saveProjectToRaw(
  project: Project,
  rootDirectoryHandle: FileSystemDirectoryHandle,
): Promise<number> {
  const permissionRequest = (rootDirectoryHandle as FileSystemDirectoryHandle & {
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }).requestPermission
  const permission = permissionRequest ? await permissionRequest.call(rootDirectoryHandle, { mode: 'readwrite' }) : 'granted'
  if (permission !== 'granted') {
    throw new Error('KnoPath needs read and write permission for the selected knowledge base directory.')
  }

  const rawHandle = await rootDirectoryHandle.getDirectoryHandle('raw', { create: true })

  const projectDirName = sanitizeProjectName(project.title)
  const projectRawHandle = await rawHandle.getDirectoryHandle(projectDirName, { create: true })

  const timestamp = formatTimestamp()
  const projectFileName = `${timestamp}-${sanitizeProjectName(project.title)}-project.md`

  const projectContent = `---
type: project
id: ${project.id}
title: ${project.title}
created: ${project.createdAt}
updated: ${new Date().toISOString()}
node_count: ${project.nodes.length}
---

# ${project.title}

## Project Overview
- Total nodes: ${project.nodes.length}
- Created: ${project.createdAt}
- Last saved: ${new Date().toISOString()}

## Nodes

${project.nodes.map((node, index) => {
  const branchPath = buildBranchPath(node.id, project)
  return `### ${index + 1}. ${node.data.question || 'Untitled node'}

- **ID**: ${node.id}
- **Type**: ${node.data.type}
- **Parent**: ${node.data.parentId || 'Root'}
- **Branch Path**: ${branchPath.join(' > ')}

#### Question
${node.data.question || 'No question'}

#### Answer
${node.data.answer || 'No answer yet'}

#### Summary
${node.data.summary || 'No summary yet'}

#### Context
${node.data.context || 'No context'}

---
`
}).join('\n')}
`

  await ensureTextFile(projectRawHandle, projectFileName, projectContent)

  return project.nodes.length
}
