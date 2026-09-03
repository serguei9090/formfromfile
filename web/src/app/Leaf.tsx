/** The radiant green-leaf mark. */
export function Leaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fff-leaf" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="oklch(0.78 0.17 150)" />
          <stop offset="1" stopColor="oklch(0.55 0.14 165)" />
        </linearGradient>
      </defs>
      <path
        d="M20 3c-9 0-15 4-15 12 0 2 .5 4 1.5 6C9 15 13 11 19 9c-4 3-7 6-9 12 8 1 13-4 13-12 0-3-1-5-3-6Z"
        fill="url(#fff-leaf)"
      />
    </svg>
  )
}
