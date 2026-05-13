export const WORKSPACE_CHROME_LAYOUT = {
  toolbarHeaderClassName:
    'z-50 flex items-center gap-3 border-b border-white/30 bg-white/60 px-4 py-2.5 backdrop-blur-xl overflow-x-auto',
  toolbarLeadClassName: 'flex shrink-0 items-center gap-3',
  toolbarToolsWrapClassName:
    'flex shrink-0 items-center gap-1',
  toolbarUtilityGroupClassName:
    'inline-flex shrink-0 items-center gap-0.5 rounded-card-sm bg-white/50 p-0.5 backdrop-blur-sm',
  toolbarUtilityButtonClassName:
    'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-card-sm px-2 text-xs text-muted-slate transition-colors hover:bg-white/60 hover:text-cohere-black disabled:cursor-not-allowed disabled:opacity-50',
  toolbarSegmentGroupClassName: 'inline-flex shrink-0 items-center gap-1 rounded-card bg-white/50 p-1 backdrop-blur-sm',
  toolbarSegmentButtonClassName:
    'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-card-sm px-2.5 text-xs transition-colors',
  toolbarSearchClassName:
    'flex h-8 shrink-0 items-center gap-2 rounded-card-sm border border-white/40 bg-white/50 px-2.5 backdrop-blur-sm',
  toolbarActionGroupClassName: 'inline-flex shrink-0 items-center gap-0.5 rounded-card-sm border border-white/40 bg-white/60 p-0.5 backdrop-blur-sm',
  insightToolbarToggleGroupClassName: 'inline-flex shrink-0 items-center gap-0.5 rounded-card-sm bg-white/50 p-0.5 backdrop-blur-sm',
  insightToolbarToggleButtonClassName:
    'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-card-sm px-2 text-xs transition-colors',
  iconButtonClassName:
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-card-sm border border-white/40 bg-white/50 text-muted-slate backdrop-blur-sm transition-colors hover:bg-white/70 hover:text-cohere-black',
  librarySidebarClassName: 'flex w-[260px] flex-col border-r border-white/30 bg-white/55 backdrop-blur-xl',
  insightUtilityRailClassName: 'flex w-[300px] shrink-0 flex-col border-r border-white/30 bg-white/55 backdrop-blur-xl',
  insightCollapsedRailClassName:
    'flex w-[72px] shrink-0 flex-col items-center border-r border-white/30 bg-white/55 backdrop-blur-xl px-3 py-4',
} as const
