// Soundwave mark, same geometry as assets/logo.svg; drawn in currentColor so it follows the theme.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 129 120" fill="currentColor" className={className} aria-hidden="true">
      <rect x="0" y="46" width="16" height="28" rx="8" />
      <rect x="23" y="32" width="16" height="56" rx="8" />
      <path
        fillRule="evenodd"
        d="M46 8a8 8 0 0 1 16 0v21.5a3.5 3.5 0 0 0 7 0V26a8 8 0 0 1 16 0v68a8 8 0 0 1-16 0v-3.5a3.5 3.5 0 0 0-7 0V112a8 8 0 0 1-16 0ZM62 46.5a3.5 3.5 0 0 1 7 0v27a3.5 3.5 0 0 1-7 0Z"
      />
      <rect x="92" y="42" width="16" height="36" rx="8" />
      <circle cx="122" cy="60" r="7" />
    </svg>
  );
}
