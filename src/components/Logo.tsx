/** Momentum mark (same geometry as assets/app-icon.svg), tinted with the current accent. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="6.9" fill="var(--accent)" />
      <path d="M7.25 22.6c5.4 0 9.25-3.55 11.9-10.75" fill="none" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" />
      <path d="M14.9 12.5l4.6-3.25 1.8 5.45" fill="none" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.25" cy="21.9" r="2" fill="var(--accent-fg)" opacity="0.78" />
    </svg>
  );
}
