# Issue #1526: Make the All Namespaces Service Map readable

Issue: [Service Map: the "All Namespaces" view is unreadable on a large cluster][issue].

[issue]: https://github.com/antrea-io/antrea-ui/issues/1526

## Scope and dependencies

This branch builds on issue #1523's incremental layout (`931247df`). Antonin's
issue description and prototype define the behavior; the supplied screenshots
illustrate expandable Namespace outlines. No backend or dependency changes are
required. Single-Namespace scope keeps workload granularity.

## Implementation design

In cluster-wide scope, identified workload and destination Service endpoints
fold into `namespace:<name>` nodes. Expanding a Namespace replaces its aggregate
with its workloads inside the existing outline; the outline's collapse action
and a Collapse all namespaces button reverse this operation. All controls support
keyboard activation.

Graph construction folds endpoints before merging directed edges. Counts, bytes,
and bit rates sum; ports, policies, and flow types union. Existing worst-verdict
coloring therefore continues to apply. Internal connections are counted directly
from the visible FlowStore entries before the self-edge check, including traffic
between Pods of the same workload. Each internal connection contributes once.
Folded nodes show internal and denied counts, with byte totals in their tooltip.
Internal denials color the summary and outline red. Identified Namespace titles
use the standard readable node text color, while withheld nodes retain their style.
No self-loop is drawn.

External, undisclosed, and undisclosed-Namespace endpoints keep their established
identities. They never expand or merge with a disclosed Namespace, even if the
names match. No address correlation or inference of withheld membership occurs.
Only endpoints already identified by the existing disclosure logic can fold.

A separate helper chooses the busiest 50 directed edges by connection count,
with controls for 25, 50, 100, 200, or all, in every scope. Ties use stable endpoint
keys. The themed selector and reactive shown/total edge count make the limit
visible, with explanatory text that exploration exceptions can exceed it. A
challenger replaces the weakest retained edge only when its count is
strictly greater than 120% of that edge's count. Scope or filter changes reset
ranking and exploration state; changing the limit reranks immediately.

Expanded workloads always show all adjacent edges. Hover reveals all adjacent
edges and dims unrelated nodes and edges. Each other node has a toggle to pin
its edges. Selected edges remain visible until their identity disappears, at
which point selection emits `null`. Hover, pin, and selection exceptions do not
participate in layout forces; only ranked and expanded-workload edges do. All
nodes remain in the map even when none of their edges rank highly enough.

Expansion seeds children around their former Namespace position. Nearby nodes
move aside, while distant positions and user drag pins survive. Collapse seeds
the aggregate at the children's centroid. The inherited incremental layout
preserves zoom and does not reheat for hover, pin, or edge-only changes.

The plugin `EdgeSelection` contract gains optional `sourceKind` and `targetKind`.
The SDK re-exports that same type. Existing fields remain unchanged; IDs are
opaque, and consumers can distinguish namespace aggregates without parsing an
ID. Older hosts may omit kinds. Plugin documentation records these semantics.

## Independent design decisions

An independent decision agent resolved the issue's open prototype questions:
fixed top-N by connections, 20% hysteresis, limits in every scope, expanded
workload exceptions, worst verdict, visible-entry internal traffic summaries,
and explicit plugin kind metadata. Recent-activity windows and alternate
aggregation thresholds are outside this issue's implementation scope.

## Validation

Regression coverage includes directed aggregate totals, merged ports and
policies, worst verdict, same-workload internal drops, redaction isolation,
non-expandable withheld nodes, plugin kind payloads and selection clearing,
stable ties and hysteresis, stale ranking removal, hover and pin exceptions,
structural layout links, no hover/pin reheating, local expansion displacement,
user pins, and collapse centroids. Existing flow visibility and incremental
layout tests remain in place. TypeScript, ESLint, and Markdown checks accompany
the focused tests.

A real large-cluster streaming benchmark and interactive browser review remain
useful follow-up validation; the unit tests do not establish rendering frame
rates or visually assess every overlapping-label case.
