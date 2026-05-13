import { Fragment, useEffect, useRef } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { slugifyHeading } from '../lib/insightOutline'

interface MarkdownContentProps {
  content: string
  className?: string
  headingIdPrefix?: string
  highlightQuery?: string
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim()
  const firstPipe = trimmed.indexOf('|')
  const tablePart = firstPipe >= 0 ? trimmed.substring(firstPipe) : trimmed
  return tablePart
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

let highlightCounter = 0

function renderInline(text: string, highlightQuery?: string) {
  const parts: Array<{ type: 'text' | 'code'; value: string }> = []
  const pattern = /`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'code', value: match[1] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) })
  }

  const renderTextWithStrong = (value: string, keyPrefix: string) => {
    const parts: Array<{ type: 'text' | 'strong' | 'latex'; value: string }> = []
    const combinedPattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)|(\*\*(.+?)\*\*)/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = combinedPattern.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: value.slice(lastIndex, match.index) })
      }
      if (match[1]) {
        parts.push({ type: 'latex', value: match[1] })
      } else if (match[3]) {
        parts.push({ type: 'strong', value: match[3] })
      }
      lastIndex = combinedPattern.lastIndex
    }

    if (lastIndex < value.length) {
      parts.push({ type: 'text', value: value.slice(lastIndex) })
    }

    return parts.map((part, partIndex) => {
      if (part.type === 'strong') {
        return (
          <strong key={`${keyPrefix}-strong-${partIndex}`} className="font-semibold text-cohere-black">
            {applyHighlight(part.value, `${keyPrefix}-strong-hl-${partIndex}`, highlightQuery)}
          </strong>
        )
      }
      if (part.type === 'latex') {
        const latex = part.value.slice(1, -1)
        const isBlock = part.value.startsWith('$$')
        try {
          const html = katex.renderToString(latex, {
            displayMode: isBlock,
            throwOnError: false,
            trust: true,
          })
          return (
            <span
              key={`${keyPrefix}-latex-${partIndex}`}
              className={isBlock ? 'katex-display' : ''}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        } catch {
          return <Fragment key={`${keyPrefix}-latex-error-${partIndex}`}>{part.value}</Fragment>
        }
      }
      return <Fragment key={`${keyPrefix}-text-${partIndex}`}>{applyHighlight(part.value, `${keyPrefix}-hl-${partIndex}`, highlightQuery)}</Fragment>
    })
  }

  return parts.map((part, index) =>
    part.type === 'code' ? (
      <code key={index} className="rounded bg-cohere-black/[0.06] px-1 py-0.5 font-mono text-[0.92em] text-cohere-black">
        {part.value}
      </code>
    ) : (
      <Fragment key={index}>{renderTextWithStrong(part.value, `part-${index}`)}</Fragment>
    ),
  )
}

function applyHighlight(text: string, keyPrefix: string, query?: string): React.ReactNode {
  if (!query || !query.trim()) return text

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const segments: Array<{ type: 'text' | 'match'; value: string }> = []
  let lastIdx = 0
  let searchIdx = 0

  while (searchIdx < lowerText.length) {
    const foundAt = lowerText.indexOf(lowerQuery, searchIdx)
    if (foundAt < 0) break

    if (foundAt > lastIdx) {
      segments.push({ type: 'text', value: text.slice(lastIdx, foundAt) })
    }
    segments.push({ type: 'match', value: text.slice(foundAt, foundAt + query.length) })
    lastIdx = foundAt + query.length
    searchIdx = lastIdx
  }

  if (segments.length === 0) return text

  if (lastIdx < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIdx) })
  }

  return segments.map((seg, i) => {
    if (seg.type === 'match') {
      highlightCounter++
      const isFirst = highlightCounter === 1
      return (
        <mark
          key={`${keyPrefix}-m-${i}`}
          id={isFirst ? 'search-highlight-first' : undefined}
          className="rounded-[3px] bg-amber-200/80 px-0.5 text-cohere-black"
        >
          {seg.value}
        </mark>
      )
    }
    return <Fragment key={`${keyPrefix}-t-${i}`}>{seg.value}</Fragment>
  })
}

export default function MarkdownContent({ content, className, headingIdPrefix, highlightQuery }: MarkdownContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!highlightQuery) return
    requestAnimationFrame(() => {
      const firstMark = containerRef.current?.querySelector('#search-highlight-first')
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }, [highlightQuery, content])

  highlightCounter = 0

  let normalized = content.replace(/\r\n/g, '\n').trim()

  if (!normalized) return null

  const labelPatterns = [
    /^Key Points?:\s*$/gi,
    /^Core Concepts?:\s*$/gi,
    /^要点[：:]\s*$/,
    /^核心概念[：:]\s*$/,
    /^关键点[：:]\s*$/,
    /^主要特点[：:]\s*$/,
    /^主要特性[：:]\s*$/,
    /^Connections?:\s*$/gi,
    /^关联[：:]\s*$/,
    /^Open Questions?:\s*$/gi,
    /^待探索问题[：:]\s*$/,
  ]

  normalized = normalized
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      for (const pattern of labelPatterns) {
        if (pattern.test(trimmed)) {
          return `### ${trimmed.replace(/[：:]\s*$/, '')}`
        }
      }
      return line
    })
    .join('\n')

  const lines = normalized.split('\n')

  const preprocessed: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('$$')) {
      const blockLines: string[] = [line]
      if (!line.trim().endsWith('$$') || line.trim() === '$$') {
        i += 1
        while (i < lines.length) {
          blockLines.push(lines[i])
          if (lines[i].trim().endsWith('$$')) {
            i += 1
            break
          }
          i += 1
        }
      } else {
        i += 1
      }
      preprocessed.push(blockLines.join('\n'))
    } else {
      preprocessed.push(line)
      i += 1
    }
  }
  const blocks: JSX.Element[] = []
  let index = 0
  let key = 0
  const headingCounts = new Map<string, number>()

  while (index < preprocessed.length) {
    const line = preprocessed[index]
    let trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = []
      index += 1
      while (index < preprocessed.length && !preprocessed[index].trim().startsWith('```')) {
        codeLines.push(preprocessed[index])
        index += 1
      }
      if (index < preprocessed.length) index += 1

      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-[14px] bg-[#111318] px-3 py-2.5 text-[12px] leading-relaxed text-white">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s+/g, ''))) {
      blocks.push(
        <hr key={key++} className="border-0 border-t border-border-light/80" />,
      )
      index += 1
      continue
    }

    if (trimmed.includes('|') && index + 1 < preprocessed.length && isTableSeparator(preprocessed[index + 1].trim())) {
      const firstPipeIdx = trimmed.indexOf('|')
      const textBeforePipe = trimmed.substring(0, firstPipeIdx).trim()
      if (textBeforePipe.length > 0) {
        blocks.push(
          <p key={key++} className="break-words">
            {renderInline(textBeforePipe, highlightQuery)}
          </p>,
        )
        trimmed = trimmed.substring(firstPipeIdx)
      }

      const headerCells = parseTableRow(trimmed)
      const bodyRows: string[][] = []
      index += 3

      while (index < preprocessed.length) {
        const current = preprocessed[index].trim()
        if (!current || !current.includes('|') || isTableSeparator(current)) {
          break
        }
        bodyRows.push(parseTableRow(current))
        index += 1
      }

      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-[14px] border border-border-light">
          <table className="markdown-table min-w-full border-collapse text-left text-[0.95em]">
            <thead className="bg-snow/90">
              <tr>
                {headerCells.map((cell, cellIndex) => (
                  <th key={cellIndex} className="border-b border-border-light px-3 py-2 font-semibold text-cohere-black">
                    {renderInline(cell, highlightQuery)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  {headerCells.map((_, cellIndex) => (
                    <td key={cellIndex} className="border-t border-border-light px-3 py-2 text-near-black">
                      {renderInline(row[cellIndex] ?? '', highlightQuery)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const rawHeading = headingMatch[2].trim()
      const baseSlug = slugifyHeading(rawHeading) || `heading-${key}`
      const nextCount = (headingCounts.get(baseSlug) ?? 0) + 1
      headingCounts.set(baseSlug, nextCount)
      const headingId = headingIdPrefix
        ? `${headingIdPrefix}-${nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`}`
        : undefined
      const headingClass =
        level === 1
          ? 'text-[1.02rem] font-semibold tracking-[-0.02em]'
          : level === 2
            ? 'text-[0.95rem] font-semibold'
            : 'text-[0.88rem] font-semibold'

      blocks.push(
        <div key={key++} id={headingId} className={headingClass}>
          {renderInline(rawHeading, highlightQuery)}
        </div>,
      )
      index += 1
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < preprocessed.length && preprocessed[index].trim().startsWith('>')) {
        quoteLines.push(preprocessed[index].trim().replace(/^>\s?/, ''))
        index += 1
      }

      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 border-olive-accent/35 bg-olive-accent/[0.04] px-3 py-2 text-[12px] italic text-muted-slate"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <Fragment key={quoteIndex}>
              {quoteIndex > 0 ? <br /> : null}
              {renderInline(quoteLine, highlightQuery)}
            </Fragment>
          ))}
        </blockquote>,
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      const ordered = /^\d+\.\s+/.test(trimmed)

      while (index < preprocessed.length) {
        const current = preprocessed[index].trim()
        if (ordered ? /^\d+\.\s+/.test(current) : /^[-*]\s+/.test(current)) {
          items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''))
          index += 1
          continue
        }
        break
      }

      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag key={key++} className="ml-4 space-y-1 pl-4 marker:text-muted-slate">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, highlightQuery)}</li>
          ))}
        </ListTag>,
      )
      continue
    }

    const blockLatexMatch = trimmed.match(/^\$\$([\s\S]+)\$\$$/)
    if (blockLatexMatch) {
      const latex = blockLatexMatch[1].trim()
      try {
        const html = katex.renderToString(latex, { displayMode: true, throwOnError: false, trust: true })
        blocks.push(
          <div key={key++} className="katex-display my-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />,
        )
      } catch {
        blocks.push(<p key={key++} className="break-words">{renderInline(trimmed, highlightQuery)}</p>)
      }
      index += 1
      continue
    }

    const paragraphLines = [trimmed]
    index += 1

    while (index < preprocessed.length) {
      const current = preprocessed[index].trim()
      if (
        !current ||
        current.startsWith('```') ||
        current.startsWith('>') ||
        /^#{1,6}\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(current.replace(/\s+/g, ''))
      ) {
        break
      }
      paragraphLines.push(current)
      index += 1
    }

    blocks.push(
      <p key={key++} className="break-words">
        {renderInline(paragraphLines.join(' '), highlightQuery)}
      </p>,
    )
  }

  return <div ref={containerRef} className={['markdown-content', className].filter(Boolean).join(' ')}>{blocks}</div>
}
