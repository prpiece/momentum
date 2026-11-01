/** The app mark. `draw` traces the swoosh and arrow in, for celebrations. */
export function Logo({ size = 28, draw = false, className }: { size?: number; draw?: boolean; className?: string }) {
  const stroke = draw ? { pathLength: 1, className: "anim-draw" } : {};
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="6.9" fill="var(--accent)" />
      <path d="M7.25 22.6c5.4 0 9.25-3.55 11.9-10.75" fill="none" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" {...stroke} />
      <path d="M14.9 12.5l4.6-3.25 1.8 5.45" fill="none" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...stroke} />
      <circle cx="24.25" cy="21.9" r="2" fill="var(--accent-fg)" opacity="0.78" className={draw ? "anim-dot" : undefined} />
    </svg>
  );
}
