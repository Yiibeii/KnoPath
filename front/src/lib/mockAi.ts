export async function generateMockAnswer(question: string, context: string): Promise<string> {
  const trimmedQuestion = question.trim()
  const contextHint = context
    .split('\n')
    .find((line) => line.startsWith('- '))
    ?.replace(/^- /, '')

  await new Promise((resolve) => setTimeout(resolve, 150))

  return [
    `Question: ${trimmedQuestion}`,
    '',
    'Mock answer:',
    `This branch explores "${trimmedQuestion}" in a local-first MVP workflow.`,
    contextHint ? `It inherits prior context from: ${contextHint}` : 'It starts from a fresh root question.',
    'Use this placeholder response to validate branching, summaries, and exports before wiring a real model proxy.',
  ].join('\n')
}

export async function generateMockSummary(answer: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  const firstSentence = answer
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .find(Boolean)

  return firstSentence ?? 'Summary pending.'
}
