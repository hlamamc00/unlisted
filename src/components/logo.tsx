export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="none" stroke="var(--ink)" strokeWidth="2" opacity=".35" />
      <circle cx="13" cy="13" r="6" fill="none" stroke="var(--ink)" strokeWidth="2" opacity=".7" />
      <circle cx="19" cy="8" r="3" fill="var(--accent)" />
    </svg>
  );
}
