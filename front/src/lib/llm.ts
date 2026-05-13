import type { AppSettings, ExplorationData } from '../types'
import { generateMockAnswer } from './mockAi'
import { getDefaultPrompt } from './api'
import { useStore } from '../store'

let cachedDefaultPrompt: string | null = null
let cachedLang: string | null = null

const LANG_INSTRUCTION = {
  zh: '\n\n重要提示：你必须使用简体中文回答。所有标题、要点和解释都必须使用中文。',
  en: '\n\nIMPORTANT: You MUST respond entirely in English. All section headings, bullet points, and explanations must be in English.',
}

async function getSystemPrompt(userPrompt: string): Promise<string> {
  const locale = useStore.getState().settings.locale ?? 'zh'

  if (userPrompt.trim()) {
    return userPrompt + (LANG_INSTRUCTION[locale as keyof typeof LANG_INSTRUCTION] ?? '')
  }

  if (cachedDefaultPrompt && cachedLang === locale) {
    return cachedDefaultPrompt
  }

  try {
    cachedDefaultPrompt = await getDefaultPrompt(locale)
    cachedLang = locale
    return cachedDefaultPrompt + (LANG_INSTRUCTION[locale as keyof typeof LANG_INSTRUCTION] ?? '')
  } catch {
    const fallback = locale === 'zh'
      ? '你是 KnoPath，一个知识探索助手。帮助用户通过结构化的探究方式发现、组织和连接想法。'
      : 'You are KnoPath, a knowledge exploration assistant. Help users discover, organize, and connect ideas through structured inquiry.'
    return fallback
  }
}

export interface GeneratedAnswer {
  answer: string
  summary: string
  exploration?: ExplorationData
  source: 'live' | 'mock'
  model: string
}

interface GenerateAnswerOptions {
  onDelta?: (chunk: string) => void
}

function isValidExplorationTopic(topic: string): boolean {
  if (!topic || topic.length < 2 || topic.length > 50) return false
  
  const invalidPatterns = [
    /^Core Concept:?\s*$/i,
    /^Key Points?:?\s*$/i,
    /^Connections?:?\s*$/i,
    /^Open Questions?:?\s*$/i,
    /^Suggested Next Steps?:?\s*$/i,
    /^核心概念[：:]\s*$/,
    /^要点[：:]\s*$/,
    /^关键点[：:]\s*$/,
    /^关联[：:]\s*$/,
    /^待探索问题[：:]\s*$/,
    /^建议下一步[：:]\s*$/,
    /^目标[：:]\s*$/,
    /^定义[：:]\s*$/,
    /^应用[：:]\s*$/,
    /^示例[：:]\s*$/,
    /^场景[：:]\s*$/,
    /^.*的方向$/,
    /^如需.*/,
    /^可提出.*/,
    /^我将继续.*/,
    /^深化解析$/,
    /^[一-龥]+[：:]\s*$/,
  ]
  
  return !invalidPatterns.some((p) => p.test(topic.trim()))
}

function parseJsonResponse(rawAnswer: string): { answer: string; summary: string; exploration?: ExplorationData } | null {
  let jsonStr = rawAnswer.trim()
  
  const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/i)
  if (jsonMatch) {
    jsonStr = jsonMatch[1]
  } else if (jsonStr.startsWith('```')) {
    const lines = jsonStr.split('\n')
    jsonStr = lines.slice(1, -1).join('\n')
  }
  
  try {
    const parsed = JSON.parse(jsonStr) as {
      response?: string
      summary?: string
      exploration?: {
        deep?: string[]
        lateral?: string[]
        applied?: string[]
      }
    }
    
    if (!parsed.response) return null
    
    const answer = parsed.response
    const summary = parsed.summary || ''
    
    let exploration: ExplorationData | undefined
    if (parsed.exploration) {
      exploration = {
        deep: (parsed.exploration.deep || []).filter(isValidExplorationTopic),
        lateral: (parsed.exploration.lateral || []).filter(isValidExplorationTopic),
        applied: (parsed.exploration.applied || []).filter(isValidExplorationTopic),
      }
      if (exploration.deep.length === 0 && exploration.lateral.length === 0 && exploration.applied.length === 0) {
        exploration = undefined
      }
    }
    
    return { answer, summary, exploration }
  } catch {
    return null
  }
}

function parseExploration(rawAnswer: string): ExplorationData | undefined {
  console.log('[LLM] parseExploration called, rawAnswer length:', rawAnswer.length)
  console.log('[LLM] rawAnswer tail:', rawAnswer.slice(-200))

  const cleanExplorationText = (text: string): string => {
    return text
      .replace(/^\d+[\.\)]\s*/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/^\*{1,2}/g, '')
      .replace(/\*{1,2}$/g, '')
      .replace(/^[-–—]\s*/g, '')
      .replace(/^「([^」]+)」/g, '$1')
      .trim()
  }

  const explorationMatch = rawAnswer.match(/\[EXPLORATION\]([\s\S]*?)$/i)
  if (!explorationMatch) {
    console.log('[LLM] No [EXPLORATION] found in rawAnswer, trying fallback extraction')
    return extractExplorationFromContent(rawAnswer)
  }

  const explorationText = explorationMatch[1].trim()
  console.log('[LLM] explorationText:', explorationText)

  const result: ExplorationData = { deep: [], lateral: [], applied: [] }

  const deepMatch = explorationText.match(/deep:\s*([^\n]+)/i)
  const lateralMatch = explorationText.match(/lateral:\s*([^\n]+)/i)
  const appliedMatch = explorationText.match(/applied:\s*([^\n]+)/i)

  if (deepMatch) {
    result.deep = deepMatch[1].split(',').map((s) => cleanExplorationText(s)).filter(isValidExplorationTopic)
  }
  if (lateralMatch) {
    result.lateral = lateralMatch[1].split(',').map((s) => cleanExplorationText(s)).filter(isValidExplorationTopic)
  }
  if (appliedMatch) {
    result.applied = appliedMatch[1].split(',').map((s) => cleanExplorationText(s)).filter(isValidExplorationTopic)
  }

  console.log('[LLM] parseExploration result:', result)

  if (result.deep.length === 0 && result.lateral.length === 0 && result.applied.length === 0) {
    console.log('[LLM] All exploration arrays empty, trying fallback extraction')
    return extractExplorationFromContent(rawAnswer)
  }

  return result
}

function extractExplorationFromContent(answer: string): ExplorationData | undefined {
  console.log('[LLM] extractExplorationFromContent called')

  const cleanTopicText = (text: string): string => {
    return text
      .replace(/^\d+[\.\)]\s*/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/^\*{1,2}/g, '')
      .replace(/\*{1,2}$/g, '')
      .replace(/^[-–—]\s*/g, '')
      .replace(/^「([^」]+)」/g, '$1')
      .replace(/\+\s*/g, '+')
      .trim()
  }

  const extractTopicsFromSection = (text: string): string[] => {
    const lines = text.split('\n')
    const topics: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const topic = cleanTopicText(trimmed.replace(/^[-*#\s]+/, '').replace(/[:：].*$/, '').trim())
      if (isValidExplorationTopic(topic)) {
        topics.push(topic)
      }
    }
    return topics
  }

  const deepMatch = answer.match(/深入探索[：:\s]*([\s\S]*?)(?=横向扩展|应用场景|$)/i)
  const lateralMatch = answer.match(/横向扩展[：:\s]*([\s\S]*?)(?=深入探索|应用场景|$)/i)
  const appliedMatch = answer.match(/应用场景[：:\s]*([\s\S]*?)(?=深入探索|横向扩展|$)/i)

  const result: ExplorationData = { deep: [], lateral: [], applied: [] }

  if (deepMatch) {
    result.deep = extractTopicsFromSection(deepMatch[1])
  }
  if (lateralMatch) {
    result.lateral = extractTopicsFromSection(lateralMatch[1])
  }
  if (appliedMatch) {
    result.applied = extractTopicsFromSection(appliedMatch[1])
  }

  if (result.deep.length === 0 && result.lateral.length === 0 && result.applied.length === 0) {
    const lines = answer.split('\n').filter((line) => line.trim().length > 3)
    const topics: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      const topic = cleanTopicText(trimmed.replace(/^[-*#\s]+/, '').replace(/[:：].*$/, '').trim())
      if (isValidExplorationTopic(topic)) {
        topics.push(topic)
      }
    }
    if (topics.length > 0) {
      result.deep = topics.slice(0, 3)
      result.lateral = topics.slice(3, 5)
      result.applied = topics.slice(5, 7)
    }
  }

  console.log('[LLM] Fallback exploration result:', result)

  if (result.deep.length === 0 && result.lateral.length === 0 && result.applied.length === 0) {
    return undefined
  }

  return result
}

function parseResponseAndSummary(rawAnswer: string): { answer: string; summary: string; exploration?: ExplorationData } {
  const jsonResult = parseJsonResponse(rawAnswer)
  if (jsonResult) {
    console.log('[LLM] Successfully parsed JSON response')
    return jsonResult
  }

  console.log('[LLM] JSON parse failed, falling back to legacy format')
  
  const responseMatch = rawAnswer.match(/\[RESPONSE\]([\s\S]*?)(?=\[SUMMARY\]|\[EXPLORATION\]|$)/i)
  const summaryMatch = rawAnswer.match(/\[SUMMARY\]([\s\S]*?)(?=\[EXPLORATION\]|$)/i)

  let answer = responseMatch ? responseMatch[1].trim() : rawAnswer
  let summary = summaryMatch ? summaryMatch[1].trim() : ''

  if (!responseMatch && !summaryMatch) {
    answer = rawAnswer
  }

  const exploration = parseExploration(rawAnswer)

  const invalidPatterns = [
    /^Core Concept:?\s*$/i,
    /^Key Points?:?\s*$/i,
    /^Connections?:?\s*$/i,
    /^Open Questions?:?\s*$/i,
    /^Suggested Next Steps?:?\s*$/i,
    /^核心概念[：:]\s*$/,
    /^要点[：:]\s*$/,
    /^关键点[：:]\s*$/,
    /^关联[：:]\s*$/,
    /^待探索问题[：:]\s*$/,
    /^建议下一步[：:]\s*$/,
    /^[A-Za-z\s]+:?\s*$/,
    /^[\u4e00-\u9fa5]+[：:]\s*$/,
  ]

  const isInvalidSummary = !summary || 
    summary.length < 5 || 
    invalidPatterns.some((p) => p.test(summary.trim()))

  if (isInvalidSummary && answer) {
    const lines = answer.split('\n').filter((line) => {
      const t = line.trim()
      return t.length > 15 && !t.startsWith('#') && !t.startsWith('-') && !t.startsWith('*')
    })
    
    if (lines.length > 0) {
      const firstLine = lines[0].trim()
      const colonIdx = firstLine.indexOf(':')
      summary = colonIdx > 0 && colonIdx < 15
        ? firstLine.slice(colonIdx + 1).trim().slice(0, 100)
        : firstLine.slice(0, 100)
    } else {
      const sentences = answer.split(/[.!?\n。！？]/).filter((s) => s.trim().length > 10)
      summary = sentences[0]?.trim().slice(0, 100) || ''
    }
  }

  return { answer, summary, exploration }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function extractContent(message: unknown): string {
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return message
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (message && typeof message === 'object' && 'content' in message) {
    return extractContent((message as { content: unknown }).content)
  }
  return ''
}

function extractStreamDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  const choices = (payload as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''

  return extractContent(choices[0]?.delta?.content) || extractContent(choices[0]?.message?.content)
}

async function readStreamingResponse(response: Response, onDelta?: (chunk: string) => void): Promise<string> {
  if (!response.body) {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    return extractContent(payload.choices?.[0]?.message?.content)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''

  const flushEvents = () => {
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const data = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')

      if (!data) {
        boundary = buffer.indexOf('\n\n')
        continue
      }

      if (data === '[DONE]') {
        boundary = buffer.indexOf('\n\n')
        continue
      }

      try {
        const chunk = extractStreamDelta(JSON.parse(data))
        if (chunk) {
          answer += chunk
          onDelta?.(chunk)
        }
      } catch {
        // Ignore non-JSON keepalive events from compatible providers.
      }

      boundary = buffer.indexOf('\n\n')
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    flushEvents()
  }

  buffer += decoder.decode()
  flushEvents()

  if (!answer.trim() && buffer.trim()) {
    try {
      answer = extractStreamDelta(JSON.parse(buffer.trim()))
    } catch {
      // Some proxies may leave a partial tail; ignore it if we already streamed content.
    }
  }

  return answer
}

export async function generateAnswer(
  question: string,
  context: string,
  settings: AppSettings,
  options: GenerateAnswerOptions = {},
): Promise<GeneratedAnswer> {
  const config = settings.model
  if (!config.apiKey.trim()) {
    const answer = await generateMockAnswer(question, context)
    options.onDelta?.(answer)
    return {
      answer,
      summary: 'Mock response for testing.',
      source: 'mock',
      model: 'local-mock',
    }
  }

  const systemPrompt = await getSystemPrompt(config.systemPrompt)

  const response = await fetch(joinUrl(config.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      stream: true,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...(context.trim() ? [{ role: 'system', content: `Context snapshot:\n${context}` }] : []),
        { role: 'user', content: question },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Model request failed with status ${response.status}.`)
  }

  const rawAnswer = (await readStreamingResponse(response, options.onDelta)).trim()
  if (!rawAnswer) {
    throw new Error('The model returned an empty answer.')
  }

  const { answer, summary, exploration } = parseResponseAndSummary(rawAnswer)

  return {
    answer,
    summary,
    exploration,
    source: 'live',
    model: config.model,
  }
}
