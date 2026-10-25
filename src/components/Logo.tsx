/** Momentum mark: an arc that climbs and breaks forward. Also the source for the Phase 7 app icon. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M7.5 22.5c4.5 0 8-3.2 10.5-9.5" fill="none" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" />
      <path d="M14.8 12.6l3.6-3.4 1.4 4.8" fill="none" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="21.5" r="2" fill="var(--accent-fg)" opacity="0.75" />
    </svg>
  );
}
