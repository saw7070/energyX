import { useId } from "react";

/**
 * EnergyX "Interlock X" mark: two solid bars, the rising bar passing under the falling one.
 * Single colour via `currentColor`, so callers set the colour with a text class.
 */
export function EnergyXMark({ className, title }: { className?: string; title?: string }) {
  const gap = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <mask id={gap} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <path d="M3 3.5h5.6L21 20.5h-5.6Z" fill="#000" stroke="#000" strokeWidth="2.6" strokeLinejoin="round" />
      </mask>
      <path d="M15.4 3.5H21L8.6 20.5H3Z" fill="currentColor" mask={`url(#${gap})`} />
      <path d="M3 3.5h5.6L21 20.5h-5.6Z" fill="currentColor" />
    </svg>
  );
}
