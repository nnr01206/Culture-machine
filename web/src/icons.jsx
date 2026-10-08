// Single-line icons in the poster's style (decision 27). Placeholders until the client's illustration files arrive.
const PATHS = {
  skill: <><path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" /><path d="M14 7l3 3" /></>,
  time: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  space: <><path d="M3.5 11L12 4l8.5 7" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></>,
  knowledge: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.5-1.6 1.1-2.1A6 6 0 0 0 12 3z" /></>,
  object: <><rect x="3.5" y="8.5" width="17" height="4" rx="1" /><path d="M5 12.5V20h14v-7.5M12 8.5V20" /><path d="M12 8.5C10.5 5 7 4.5 7 7s3 1.5 5 1.5zM12 8.5C13.5 5 17 4.5 17 7s-3 1.5-5 1.5z" /></>,
  companion: <><circle cx="9" cy="8" r="3" /><circle cx="16.5" cy="9" r="2.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><path d="M15 14.3c3.2-.4 6 1.8 6 5.2" /></>,
  experience: <><path d="M8 21c-2 0-3-1.8-3-4.5S6 12 8 12s3 1.8 3 4.5S10 21 8 21z" /><path d="M16 12c-2 0-3-1.8-3-4.5S14 3 16 3s3 1.8 3 4.5S18 12 16 12z" /></>,
  connection: <><path d="M2 10l3.5-3.5H9l3 2 3-2h3.5L22 10" /><path d="M5.5 6.5L4 15l4.5 3.5 2-1 1.5 1.5 2-1 1.5.5 3.5-3.5-1.5-8.5" /><path d="M9 12.5l3 3M11 10.5l3.5 3.5" /></>,
  creativity: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
};

export function CategoryIcon({ category, size = 22, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[category]}
    </svg>
  );
}

// The poster's half-filled capsule motif.
export function HalfCapsule({ size = 28, tilt = -25, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <g transform={`rotate(${tilt} 20 20)`}>
        <path d="M2.5 20a17.5 17.5 0 0 0 35 0z" fill="var(--orange)" />
        <circle cx="20" cy="20" r="17.5" fill="none" stroke="var(--orange)" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
