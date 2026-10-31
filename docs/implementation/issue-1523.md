# Issue #1523: Incremental Service Map layout

Issue: [Service Map topology restarts and per-label layout reads](https://github.com/antrea-io/antrea-ui/issues/1523).

## Problem and intended behavior

The current Service Map rebuilds every SVG element and discards node positions
when any edge, node label, or container width changes. Sparse edge churn
repeatedly restarts a full simulation. Each simulation tick also measures every
edge label with `getBBox`, interleaved with SVG writes. The namespace force
divides its centroid repeatedly, producing member-order-dependent attraction.

Keep the displayed map stable when traffic changes. Reuse existing node objects
and DOM elements, update edge metadata immediately, and run a small local layout
only when nodes arrive. Remove synchronous DOM measurements from animation ticks
and normalize namespace centroids once.

## Design decisions

- Keep the existing force layout and graph meaning. Do not change flow-store
  eviction, introduce edge retention, or alter authorization-related collapsed
  nodes.
- Reconcile simulation nodes by ID. Refresh graph metadata on the existing
  object, retaining its coordinates, velocity, and user drag pins. Remove absent
  nodes from the active simulation.
- Join SVG nodes, edges, edge labels, and namespace hulls by stable identifiers.
  Keep the content group and restore its transform from D3's current zoom state
  on each update.
- Treat edge-only changes, metadata changes, node removal, and resize as redraws
  without reheating. Update widths, verdict colors, arrowheads, labels, and
  bidirectional curves from current data.
- Seed additions 80 pixels from the centroid of their retained neighbors;
  disconnected additions start near the viewport center. Use deterministic
  ID-based angles and pin existing nodes.
- Use normal alpha for the first layout and alpha 0.15 for additions. Disable
  `forceCenter` when existing nodes are pinned, bound charge distances to 60–400
  pixels, and anchor new nodes near their seed positions. This keeps distant
  forces from throwing additions across the map.
- Size edge-label backgrounds with the existing text-width estimate. Tick
  handlers only write positions and paths; they never read layout geometry.
- Dragging stops the simulation and redraws only the changed geometry. It does
  not reheat other nodes. The old double-click handler that globally reheated
  the map is removed; D3's standard double-click zoom remains available.
- Normalize each namespace centroid before applying forces to its members.

The reusable `src/lib/service-map-layout.ts` helper owns node reconciliation and
centroid forces. Issue #1526 can reuse it for namespace aggregation without
duplicating layout bookkeeping. The page retains responsibility for rendering,
collision geometry, and graph semantics.

## Implementation

`antrea-flow-visibility-page.ts` retains its simulation across updates and uses
keyed D3 joins. Returning from list view populates the new SVG using retained
positions. Empty graphs remove all joined content and stop simulation;
subsequent data starts a fresh initial layout. Node glyphs are refreshed only
when their appearance changes, including address-count labels on undisclosed
namespace nodes. Incremental force updates clear stale link and anchor
initializers before adding nodes, avoiding references to removed nodes or
missing anchor targets.

## Validation

- Existing flow-page suite and new layout/page regression tests pass: 141 tests
  across 2 files.
- Regression coverage includes edge appearance/disappearance, resize, node and
  DOM identity, preserved zoom, updated verdicts and label widths, no label
  measurements during ticks, successive node additions, fixed existing
  positions, empty graph recovery, map/list switching, and namespace centroid
  symmetry independent of iteration order.
- Full component suite passes: 499 tests across 20 files.
- Component TypeScript check (`tsc --noEmit`) passes.
- ESLint on all changed TypeScript files passes with zero warnings.
- Component production build (`vite build`) passes. Vite reports the existing
  `__dirname` configuration migration warning.

## Limits

Text widths remain estimates consistent with existing node sizing. Pinning
established nodes prioritizes stability over global repacking; a dense
neighborhood can still have overlapping labels or hulls. No benchmark harness or
live cluster was provided for this issue, so these changes make no measured FPS
or main-thread utilization claim. Browser interaction validation and
large-cluster profiling remain useful follow-up checks.
