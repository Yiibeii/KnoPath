import type { Project, WikiGraphData, WikiPage } from '../types'

const API_BASE = 'http://localhost:8000/api/v1'

type JsonRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const error = await response.json().catch(() => null) as { detail?: unknown } | null
  return typeof error?.detail === 'string' ? error.detail : `${fallback}: ${response.statusText}`
}

async function requestJson<T>(
  path: string,
  fallbackError: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const { body, headers, ...init } = options
  const requestHeaders = new Headers(headers)

  const response = await fetch(apiUrl(path), {
    ...init,
    headers: body === undefined ? requestHeaders : withJsonHeader(requestHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError))
  }

  return response.json()
}

function withJsonHeader(headers: Headers): Headers {
  headers.set('Content-Type', 'application/json')
  return headers
}

export interface RepositorySettings {
  repositoryRoot: string
  rawPath: string
  wikiPath: string
  knopathPath: string
  databasePath: string
}

export interface RepositoryValidation {
  valid: boolean
  exists: boolean
  repositoryRoot: string | null
  hasRaw: boolean
  hasWiki: boolean
  hasKnoPath: boolean
}

export async function validateRepositorySettings(): Promise<RepositoryValidation> {
  return requestJson('/settings/repository/validate', 'Failed to validate repository')
}

export async function getDefaultPrompt(lang?: string): Promise<string> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  const data = await requestJson<{ prompt: string }>(`/settings/default-prompt${query}`, 'Failed to get default prompt')
  return data.prompt
}

export async function saveProjectToBackend(project: Project): Promise<{ message: string; nodeCount: number; filesSaved: number }> {
  return requestJson('/projects/save', 'Failed to save project', {
    method: 'POST',
    body: { project },
  })
}

export async function getWikiGraph(): Promise<WikiGraphData> {
  return requestJson('/wiki/graph', 'Failed to get wiki graph')
}

export async function importWikiPagesFromFiles(): Promise<WikiGraphData> {
  return requestJson('/wiki/import', 'Failed to import wiki pages', {
    method: 'POST',
  })
}

export async function getProjectWikiPages(projectId: string): Promise<WikiPage[]> {
  return requestJson(`/wiki/projects/${projectId}/pages`, 'Failed to get project wiki pages')
}

export async function syncWikiPages(
  projectId: string,
  modelConfig: { apiKey: string; baseUrl: string; model: string; temperature: number },
): Promise<WikiGraphData> {
  return requestJson('/wiki/sync', 'Failed to sync wiki pages', {
    method: 'POST',
    body: { projectId, modelConfig },
  })
}

export type StreamSyncEvent =
  | { type: 'start'; total: number; project: string }
  | { type: 'progress'; index: number; total: number; node: string; status: string }
  | { type: 'page'; index: number; total: number; title: string; pageId: string; summary: string; status?: 'generated' | 'skipped' }
  | { type: 'complete'; success: number; skipped?: number; total: number }
  | { type: 'error'; message: string }
  | { type: 'retry'; node_id: string; attempt: number }
  | { type: 'node_failed'; node_id: string; error: string }

export async function* streamSyncWikiPages(
  projectId: string,
  modelConfig: { apiKey: string; baseUrl: string; model: string; temperature: number },
  signal?: AbortSignal,
): AsyncGenerator<StreamSyncEvent> {
  const response = await fetch(apiUrl('/wiki/sync/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, modelConfig }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to sync wiki pages'))
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          yield data as StreamSyncEvent
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}

export async function compileWiki(
  projectId: string,
  modelConfig: { apiKey: string; baseUrl: string; model: string; temperature: number },
): Promise<WikiGraphData> {
  return requestJson('/wiki/compile', 'Failed to compile wiki', {
    method: 'POST',
    body: { projectId, modelConfig },
  })
}

export async function deleteWikiPage(pageId: string): Promise<{ message: string }> {
  return requestJson(`/wiki/pages/${pageId}`, 'Failed to delete wiki page', {
    method: 'DELETE',
  })
}

export async function deleteWikiPageLocal(pageId: string): Promise<{ message: string }> {
  return requestJson(`/wiki/pages/${pageId}/local`, 'Failed to delete wiki page local file', {
    method: 'DELETE',
  })
}

export async function getGlobalSettings(): Promise<Record<string, unknown>> {
  return requestJson('/settings/global', 'Failed to get global settings')
}

export async function getEnvConfig(): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  return requestJson('/settings/env-config', 'Failed to get env config')
}

export async function updateGlobalSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
  return requestJson('/settings/global', 'Failed to update global settings', {
    method: 'PUT',
    body: settings,
  })
}

export async function getRepositorySettings(): Promise<RepositorySettings> {
  return requestJson('/settings/repository', 'Failed to get repository settings')
}

export async function updateRepositorySettings(repositoryRoot: string): Promise<RepositorySettings> {
  return requestJson('/settings/repository', 'Failed to update repository settings', {
    method: 'PUT',
    body: { repositoryRoot },
  })
}

export async function getProjects(): Promise<Project[]> {
  const data = await requestJson<Project[]>('/projects', 'Failed to get projects')
  return data.map((p: any) => ({
    ...p,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    isFavorite: p.isFavorite ?? false,
  }))
}

export async function getProject(projectId: string): Promise<Project> {
  const data = await requestJson<Project>(`/projects/${projectId}`, 'Failed to get project')
  return {
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
    isFavorite: data.isFavorite ?? false,
  }
}

export async function createProject(title: string = 'Untitled Project'): Promise<Project> {
  const data = await requestJson<Project>('/projects', 'Failed to create project', {
    method: 'POST',
    body: { title },
  })

  return {
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
    isFavorite: data.isFavorite ?? false,
  }
}

export async function importProjectsFromFiles(): Promise<Project[]> {
  const data = await requestJson<Project[]>('/projects/import', 'Failed to import projects', {
    method: 'POST',
  })

  return data.map((p: any) => ({
    ...p,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
    isFavorite: p.isFavorite ?? false,
  }))
}

export async function importProjectFromJson(title: string, jsonData: unknown[]): Promise<Project> {
  const data = await requestJson<Project>('/projects/import-json', 'Failed to import project from JSON', {
    method: 'POST',
    body: { title, jsonData },
  })

  return {
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
    isFavorite: data.isFavorite ?? false,
  }
}

export async function deleteProjectFromBackend(projectId: string): Promise<{ message: string }> {
  return requestJson(`/projects/${projectId}`, 'Failed to delete project', {
    method: 'DELETE',
  })
}

export async function deleteNode(projectId: string, nodeId: string): Promise<{ message: string; deletedFile: string | null }> {
  return requestJson(`/projects/${projectId}/nodes/${nodeId}`, 'Failed to delete node', {
    method: 'DELETE',
  })
}

export async function updateProject(
  projectId: string,
  data: { title?: string; isFavorite?: boolean }
): Promise<Project> {
  const result = await requestJson<Project>(`/projects/${projectId}`, 'Failed to update project', {
    method: 'PUT',
    body: data,
  })

  return {
    ...result,
    createdAt: result.createdAt || new Date().toISOString(),
    updatedAt: result.updatedAt || new Date().toISOString(),
    isFavorite: result.isFavorite ?? false,
  }
}

export interface LintResult {
  orphanPages: Array<{ pageId: string; title: string; reason: string }>
  missingLinks: Array<{ sourcePageId: string; sourceTitle: string; referencedTitle: string; reason: string }>
  brokenLinksRemoved: number
  suggestions: string[]
  pageCount: number
  linkCount: number
  isHealthy: boolean
}

export interface LogEntry {
  timestamp: string
  operation: string
  title: string
  details: string
  pageTitles: string[]
  projectId?: string
  projectTitle?: string
}

export async function getWikiLint(projectId: string, autoFix: boolean = false): Promise<LintResult> {
  const params = new URLSearchParams()
  if (autoFix) params.set('auto_fix', 'true')
  const query = params.toString() ? '?' + params.toString() : ''
  return requestJson(`/wiki/lint/${projectId}${query}`, 'Failed to run wiki lint')
}

export async function getWikiLintAll(autoFix: boolean = false): Promise<Record<string, LintResult>> {
  const params = new URLSearchParams()
  if (autoFix) params.set('auto_fix', 'true')
  const query = params.toString() ? '?' + params.toString() : ''
  return requestJson(`/wiki/lint${query}`, 'Failed to run wiki lint')
}

export async function getWikiLogs(projectId?: string): Promise<LogEntry[]> {
  return requestJson(projectId ? `/wiki/logs/${projectId}` : '/wiki/logs', 'Failed to get wiki logs')
}
