// Root route-transition fallback: shown while a top-level segment (marketing,
// auth, client portal, admin) streams in — a quiet branded spinner on the
// marketing cream instead of a blank white flash. Intra-section navigations
// keep their shells (this boundary sits above the section layouts).
export default function Loading() {
  return (
    <div className="load-page" role="status" aria-label="Loading">
      <div className="load-spinner" />
    </div>
  );
}
