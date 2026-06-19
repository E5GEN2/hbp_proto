// Runtime navigation history for the universal backlink (canon navBackStack).
//
// Canon model: drilling into a screen via an entity link PUSHES the current
// screen; sidebar / breadcrumb nav is a STRUCTURAL jump that CLEARS the stack;
// the backlink POPS back to the previous screen. The backlink therefore always
// returns to the ACTUAL previous page — however deep you drilled — not a fixed
// structural parent.
//
// Module-level (not sessionStorage) so it mirrors canon exactly: it survives
// client-side route transitions (same JS context) and RESETS on a full page
// load / direct deep-link (fresh module → empty stack → no backlink), which is
// what the single-page prototype does.

export type NavEntry = { path: string; label: string };

let stack: NavEntry[] = [];
let structural = false;

const pathOf = (p: string) => p.split('?')[0];

// Called onClick by sidebar nav items + breadcrumb segments: the next recorded
// navigation is a structural jump and clears the drill-down trail.
export function signalStructural() {
  structural = true;
}

// Record arriving on `path` (pathname + query) with display `label`. Returns the
// previous entry (the backlink target) or null when there's nowhere to go back.
export function recordNav(path: string, label: string): NavEntry | null {
  const cur: NavEntry = { path, label };
  if (structural) {
    stack = [cur];
  } else if (stack.length && pathOf(stack[stack.length - 1].path) === pathOf(path)) {
    // Same logical page (query/filter change or effect re-run): replace the top
    // entry — capture the latest query for state restore — without growing the trail.
    stack[stack.length - 1] = cur;
  } else {
    const idx = stack.findIndex(e => e.path === path);
    if (idx >= 0) {
      // Returned to a page already in the trail (backlink / breadcrumb-up): pop to it.
      stack = stack.slice(0, idx + 1);
    } else {
      // Drilled into a new page.
      stack.push(cur);
    }
  }
  structural = false;
  return stack.length >= 2 ? stack[stack.length - 2] : null;
}
