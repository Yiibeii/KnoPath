export const WELCOME_OVERLAY_LAYOUT = {
  shellClassName:
    'h-full w-full overflow-y-auto px-4 sm:px-6',
  contentClassName: 'mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-0 py-10 lg:px-8 lg:py-12',
  heroWrapClassName: 'mx-auto max-w-3xl text-center',
  heroTitleClassName:
    'mx-auto mt-5 max-w-3xl font-display text-[40px] leading-[0.96] tracking-[-0.05em] text-cohere-black sm:text-[48px] lg:text-[56px]',
  heroBodyClassName: 'mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-slate sm:text-base',
  ctaClassName:
    'mb-10 mt-8 inline-flex items-center gap-2 rounded-full bg-cohere-black px-6 py-3 text-base text-white transition-colors hover:bg-deep-dark cursor-pointer lg:mb-14',
  featuresGridClassName: 'grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3 xl:gap-6',
  featureCardClassName:
    'rounded-card border border-white/30 bg-white/60 p-5 text-left shadow-[0_18px_40px_rgba(23,23,28,0.04)] backdrop-blur-xl',
  footnoteClassName: 'mt-6 pb-2 text-center text-[11px] uppercase tracking-[0.18em] text-muted-slate sm:mt-8 sm:text-xs',
} as const
