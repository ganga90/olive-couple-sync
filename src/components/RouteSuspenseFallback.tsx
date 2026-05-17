// Lazy-route Suspense fallback. Rendered for the milliseconds between
// React.lazy() resolving the next route's chunk and the component
// mounting. Intentionally minimal:
//   * One element, no layout shift (matches AppLayout's content area).
//   * The 🌿 motif keeps the brand-voice signature visible.
//   * No spinner animation that requires extra CSS — pure pulse on
//     opacity, defined inline so this file has zero dependencies.
//
// If a route routinely shows this fallback for > 500ms the right fix is
// to split its chunk smaller or pre-warm it on hover, not to make this
// component fancier.

export function RouteSuspenseFallback() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex h-[60vh] items-center justify-center"
    >
      <div className="text-2xl opacity-60 animate-pulse" aria-hidden="true">🌿</div>
    </div>
  );
}
