/** App mark: two overlapping circles (people) splitting a coin — "shared expenses". */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ColleagueSplit logo">
      <rect width="64" height="64" rx="16" fill="#0f766e" />
      <circle cx="25" cy="32" r="14" fill="#ffffff" fillOpacity="0.92" />
      <circle cx="39" cy="32" r="14" fill="#5eead4" fillOpacity="0.9" />
      <path d="M32 20.2a14 14 0 0 1 0 23.6 14 14 0 0 1 0-23.6Z" fill="#0f766e" />
    </svg>
  );
}
