export function getInsightDisplayTitle(summary: string | undefined, question: string | undefined): string {
  return summary?.trim() || question?.trim() || 'Untitled Insight'
}

export function getInsightTitleSourceField(summary: string | undefined): 'summary' | 'question' {
  return summary?.trim() ? 'summary' : 'question'
}
