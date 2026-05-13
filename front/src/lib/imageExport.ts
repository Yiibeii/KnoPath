import type { Project } from '../types'
import { buildShareExportLayout } from './exportLayout'

interface WrappedLineSet {
  lines: string[]
  truncated: boolean
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): WrappedLineSet {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return { lines: [], truncated: false }

  const lines: string[] = []
  let truncated = false

  const paragraphs = normalized.split('\n')

  const pushLine = (line: string) => {
    if (lines.length < maxLines) {
      lines.push(line)
      return true
    }
    truncated = true
    return false
  }

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      if (lines.length > 0 && lines.length < maxLines) {
        lines.push('')
      } else if (lines.length >= maxLines) {
        truncated = true
        break
      }
      continue
    }

    const tokens = Array.from(paragraph)
    let currentLine = ''

    for (const token of tokens) {
      const nextLine = `${currentLine}${token}`
      if (!currentLine || context.measureText(nextLine).width <= maxWidth) {
        currentLine = nextLine
        continue
      }

      if (!pushLine(currentLine)) {
        break
      }
      currentLine = token
    }

    if (truncated) break

    if (currentLine) {
      if (!pushLine(currentLine)) {
        break
      }
    }
  }

  if (truncated && lines.length > 0) {
    const lastLine = lines[lines.length - 1].replace(/\.\.\.$/, '')
    lines[lines.length - 1] = lastLine.length > 1 ? `${lastLine.slice(0, -1)}...` : `${lastLine}...`
  }

  return { lines, truncated }
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#f7f8fb')
  gradient.addColorStop(0.55, '#ffffff')
  gradient.addColorStop(1, '#eef4ff')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)

  context.fillStyle = 'rgba(24, 99, 220, 0.06)'
  context.beginPath()
  context.arc(width - 180, 120, 220, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = 'rgba(14, 165, 164, 0.05)'
  context.beginPath()
  context.arc(120, height - 140, 180, 0, Math.PI * 2)
  context.fill()
}

function drawHeader(context: CanvasRenderingContext2D, project: Project, canvasWidth: number): number {
  const headerX = 64
  const headerY = 58

  context.fillStyle = '#1863dc'
  context.font = '600 13px Arial'
  context.fillText('KNOLEDGE MAP EXPORT', headerX, headerY)

  context.fillStyle = '#17171c'
  context.font = 'bold 34px Arial'
  context.fillText(project.title, headerX, headerY + 42)

  context.fillStyle = '#6b7280'
  context.font = '15px Arial'
  context.fillText(
    `${project.nodes.length} nodes • Optimized share layout`,
    headerX,
    headerY + 74,
  )

  context.strokeStyle = 'rgba(23, 23, 28, 0.08)'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(headerX, headerY + 102)
  context.lineTo(canvasWidth - 64, headerY + 102)
  context.stroke()

  return 136
}

export async function generatePngDataUrl(project: Project): Promise<string> {
  const layout = buildShareExportLayout(project)
  if (layout.nodes.length === 0) {
    throw new Error('Create at least one node before exporting the map.')
  }

  const padding = 72
  const headerHeight = 136
  const canvasWidth = Math.max(1400, Math.ceil(layout.width + padding * 2))
  const canvasHeight = Math.max(900, Math.ceil(layout.height + padding * 2 + headerHeight))

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is not available in this browser.')
  }

  canvas.width = canvasWidth
  canvas.height = canvasHeight

  drawBackground(context, canvasWidth, canvasHeight)
  const contentTop = drawHeader(context, project, canvasWidth)

  const positionedLayouts = layout.nodes.map((nodeLayout) => ({
    ...nodeLayout,
    x: nodeLayout.x + padding,
    y: nodeLayout.y + padding + contentTop,
  }))

  const lookup = new Map(positionedLayouts.map((nodeLayout) => [nodeLayout.node.id, nodeLayout]))

  context.strokeStyle = 'rgba(24, 99, 220, 0.18)'
  context.lineWidth = 3
  for (const edge of project.edges) {
    const source = lookup.get(edge.source)
    const target = lookup.get(edge.target)
    if (!source || !target) continue

    const startX = source.x + source.width
    const startY = source.y + source.height / 2
    const endX = target.x
    const endY = target.y + target.height / 2
    const curveOffset = Math.max(90, (endX - startX) * 0.45)

    context.beginPath()
    context.moveTo(startX, startY)
    context.bezierCurveTo(startX + curveOffset, startY, endX - curveOffset, endY, endX, endY)
    context.stroke()
  }

  for (const layoutNode of positionedLayouts) {
    const { node, x, y, width, height } = layoutNode
    const bodyText = node.data.summary || node.data.answer || 'No summary yet.'
    const titleX = x + 26
    const titleY = y + 52
    const titleLineHeight = 28
    const bodyTopGap = 18
    const bodyLineHeight = 21

    context.save()
    context.shadowColor = 'rgba(15, 23, 42, 0.08)'
    context.shadowBlur = 26
    context.shadowOffsetY = 16
    roundRect(context, x, y, width, height, 28)
    context.fillStyle = '#ffffff'
    context.fill()
    context.restore()

    roundRect(context, x, y, width, height, 28)
    context.strokeStyle = 'rgba(23, 23, 28, 0.08)'
    context.lineWidth = 1.5
    context.stroke()

    context.fillStyle = '#0f172a'
    context.font = 'bold 22px Arial'
    const titleLines = wrapText(context, node.data.question || 'Untitled node', width - 52, 3).lines
    titleLines.forEach((line, index) => {
      context.fillText(line, titleX, titleY + index * titleLineHeight)
    })

    context.fillStyle = '#475569'
    context.font = '15px Arial'
    const summaryLines = wrapText(context, bodyText, width - 52, node.data.type === 'root' ? 4 : 3).lines
    const summaryStartY = titleY + Math.max(titleLines.length, 1) * titleLineHeight + bodyTopGap
    summaryLines.forEach((line, index) => {
      context.fillText(line, titleX, summaryStartY + index * bodyLineHeight)
    })

    if (node.data.isMarked) {
      context.fillStyle = '#f59e0b'
      context.beginPath()
      context.arc(x + width - 28, y + height - 28, 6, 0, Math.PI * 2)
      context.fill()
    }
  }

  return canvas.toDataURL('image/png')
}
