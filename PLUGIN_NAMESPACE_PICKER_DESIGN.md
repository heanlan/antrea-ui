# Exposing the Namespace picker to plugins

Follow-up to [#1560](https://github.com/antrea-io/antrea-ui/pull/1560) (plugin permission
gating). Based on `upstream/main` at `6e7b4e68`.

## Goal

A plugin page that declares `namespaceScope: true` (a route or an Overview tab) should be able
to use the Namespace picker that Overview and Flow Visibility use. It should behave the same:
the same picker, the same default order, the same URL handling and the same last-scope
bookkeeping. The plugin author should not have to re-implement
[namespace-scope-ux.md](docs/design/namespace-scope-ux.md).

Non-goals: changing the scope rules themselves; making the picker an authorization decision
(it stays a hint, and the plugin still handles 403s); federated Angular routes, which read
`namespace` from their own router.

## What upstream/main already has

#1560 did the host half of the contract. For a route or tab whose `requires` has
`namespaceScope: true`:

- `PluginPage` / `NamespaceAwarePluginElement`
  ([pages.tsx](client/web/antrea-ui/src/pages.tsx)) hands the element `locationSearch` and
  listens for `antrea-namespace-scope-change` (the router adopts the URL) and
  `antrea-namespace-scope-chosen` (`setLastScope`).
- Sidebar entries carry the last scope chosen
  ([lastScope.ts](client/web/antrea-ui/src/lastScope.ts), `getPluginSidebarEntries`).
- `docs/plugins.md` lists what the page must do itself: follow `locationSearch`, report every
  valid scope, and write only explicit choices to the URL.

The page half lives only inside the built-in pages:

| Piece | Where | Visible to plugins today |
| --- | --- | --- |
| `<antrea-namespace-picker>` | [antrea-namespace-picker.ts](client/web/antrea-ui-components/src/antrea-namespace-picker.ts) | Defined globally, but has no types and no styles (see below) |
| `NamespaceAccess` (`namespaceAccess()`, `searchNamespaces`, `scopeNote`, `isValidNamespaceName`) | [namespace-access.ts](client/web/antrea-ui-components/src/lib/namespace-access.ts) | No |
| `parseScopeParam`, `writeScopeToURL`, `dispatchScopeChosen`, `SCOPE_ALL` | [namespace-scope.ts](client/web/antrea-ui-components/src/lib/namespace-scope.ts) | Only the event names and `ALL_NAMESPACES_PARAM_VALUE` |
| The page logic: follow URL, default order, validate typed names, re-report on mount, scope note | Copied into [antrea-overview-page.ts](client/web/antrea-ui-components/src/pages/antrea-overview-page.ts) (`_applyScopeFromURL`, `_defaultScope`, `_onScopeSelect`, `_refreshScopeNote`, `firstUpdated`) and [antrea-flow-visibility-page.ts](client/web/antrea-ui-components/src/pages/antrea-flow-visibility-page.ts) | No |

## Why plugins can't just import it

1. **Module state is per bundle.** A plugin is its own Vite build with its own copy of any npm
   dependency (the same reason the registry lives on `window`). If a plugin bundles
   `namespace-access.ts`, it gets a second `accessSummary()` memo, a second Namespace list
   memo and a second `apiBase`. `onAccessSummaryReset` only reaches the host's copy, so on
   sign-out the plugin's copy keeps the previous user's Namespace list. That leaks one user's
   list to the next user in the same tab, the exact case `lastScope.ts` guards against.
2. **The root entry can't be imported.** `@antrea/ui-components` defines every custom element
   as a side effect, so importing it in the host throws. `docs/plugins.md` already says so for
   `apiFetch`.
3. **The picker has no styles of its own.** It renders into its light DOM so the containing
   page's `pageStyles` + `pickerStyles` (`.field-group`, `.field-input`, `.combobox-*`) apply.
   In a plugin's shadow root those rules don't exist, so it renders unstyled. Because the tag
   is registered globally, `<antrea-namespace-picker>` already upgrades inside a plugin. It
   just looks broken and needs a `NamespaceAccess` the plugin can't build.
4. **The rules will change.** Rule 5 includes the Settings default (step 2) and stars
   (step 4), which upstream code doesn't implement yet. A plugin that copies today's
   `_defaultScope()` stays on the old order once they land.

So the logic must run in the host's copy of `@antrea/ui-components`, and plugins reach it
through `window.__antreaPluginHost`, the same way `access()` works.

## Design

There are two layers. Both are implemented once in `@antrea/ui-components` and published by
the host:

- **A. A headless scope controller** holds all page-side rules. The built-in pages use it too,
  so there is one implementation.
- **B. A ready-made element**, `<antrea-namespace-scope>`, wraps the controller around the
  existing picker with its own styles. Most plugins only need this.

A plugin that wants its own picker uses A directly. Rule 11 allows it to "replace parts, such
as its picker".

### A. `NamespaceScopeController`

New file `client/web/antrea-ui-components/src/lib/namespace-scope-controller.ts`. It is
framework-agnostic: no Lit and no React, only an `EventTarget` to dispatch from and a listener
set, so a Lit page, a React page and a vanilla plugin can all drive it.

```ts
/** The scope in force, as a plugin sees it. */
export type NamespaceScope = { kind: 'all' } | { kind: 'namespace'; namespace: string };

export interface NamespaceScopeState {
    /** The scope in force, or null for none (still loading, invalid URL, or nothing to pick). */
    scope: NamespaceScope | null;
    /** Where it came from. Only 'url' and 'picker' are choices: 'default' is never reported to
     * the host or written to the URL (rules 5 and 12). */
    source: 'url' | 'picker' | 'default' | null;
    /** What the picker offers. Null until the summary and the Namespace list have loaded or
     * failed. */
    access: NamespaceAccess | null;
    /** Why there is no scope or the requested one was refused: an invalid `?namespace=`, or a
     * typed name that is not a Namespace name. */
    error: string | null;
    /** The rule 6 note on a selected Namespace that is not in the list. */
    note: ScopeNote | null;
    /** Whether All Namespaces is offered (the verdict is not denied, or it is in force). */
    offerAll: boolean;
}

export interface NamespaceScopeOptions {
    /** Where the scope events are dispatched from: the plugin's own element, or any node inside
     * it (the events bubble and are composed). */
    target: EventTarget;
    /** The page's permissions, any-of, as in `requires.resources`. They decide the cluster-wide
     * verdict (pageVerdict). Absent: allowed for a cluster admin, unknown otherwise (rule 11). */
    resources?: ResourceQuery[];
}

export interface NamespaceScopeHandle {
    state(): NamespaceScopeState;
    subscribe(listener: (state: NamespaceScopeState) => void): () => void;
    /** Feed it the `locationSearch` property the host sets on the element, each time it changes.
     * undefined: read window.location.search and follow popstate (a host that passes nothing). */
    setLocationSearch(search: string | undefined): void;
    /** The user chose a scope. `typed` as in ScopeSelectDetail: a typed value is validated as a
     * Namespace name. Writes the URL and reports the choice. */
    select(scope: NamespaceScope, typed?: boolean): void;
    /** Replace the verdict's permissions (Flow Visibility switches between watch and list). */
    setResources(resources: ResourceQuery[] | undefined): void;
    /** Stops listening and drops pending work. Call it from disconnectedCallback. */
    dispose(): void;
}

export function createNamespaceScope(options: NamespaceScopeOptions): NamespaceScopeHandle;
```

It does what the two built-in pages do now, moved without behavior changes:

- **URL first (rule 5.1).** `parseScopeParam` runs as soon as `setLocationSearch` is called,
  without waiting for the list. A valid scope is reported with `dispatchScopeChosen`. An
  invalid one sets `error` and `scope: null`.
- **Report again after mount.** The built-in pages repeat the report in `firstUpdated`,
  because the React host attaches its listeners (ref callback) only after `connectedCallback`.
  The controller does the same in a microtask after the first `setLocationSearch`. React's
  commit is synchronous, so the listener is attached by then. This needs a test against
  `NamespaceAwarePluginElement`.
- **Default order (rules 5.2 to 5.5)** waits for `access`. Today that means All Namespaces if
  `clusterWide === 'allowed'`, otherwise the first candidate. When Settings and stars land,
  they are added here once and every page, plugins included, gets them.
- **`select()`** validates typed values (`isValidNamespaceName`; a typed `SCOPE_ALL` is
  rejected), calls `writeScopeToURL` (which dispatches `antrea-namespace-scope-change`) and
  `dispatchScopeChosen`, and records the written search so that its own echo through
  `locationSearch` is ignored (today's `_appliedSearch`).
- **The scope note** uses `scopeNote` with the same token/`isCurrent` guard.
- **Session expiry.** A 401 from `accessSummary()` dispatches `antrea-session-expired` from
  `target`. The host already handles that event on plugin elements.

The public `NamespaceScope` type hides the `SCOPE_ALL` sentinel (`'__cluster_wide__'`). It is
an internal value, and the URL form `_all` would be confusing as a state. `NamespaceAccess`
is exported as a type, since a custom picker needs `candidates`, `cut` and so on.

**Built-in pages move onto it.** Overview's `_applyScopeFromURL`, `_defaultScope`,
`_onScopeSelect`, `_refreshScopeNote` and the `firstUpdated` re-report become a thin Lit
`ReactiveController` adapter over the handle (subscribe calls `requestUpdate`). The existing
Overview and Flow Visibility tests are the safety net for "no behavior change". Flow
Visibility is more coupled: `_clusterWide` and `_observedNs`, the follow/list verdict through
`setResources`, and closing the filter menus on a scope change. It can move in a separate
step, but it should move: otherwise the duplicated code stays.

### B. `<antrea-namespace-scope>`

New file `client/web/antrea-ui-components/src/antrea-namespace-scope.ts`, defined by the
host's bundle like every other element. A plugin uses the tag and imports nothing at runtime.

- **Properties:** `locationSearch` (pass through what the host set on the plugin element) and
  `resources` (`ResourceQuery[]`). Optional `label` and `inputId` are forwarded to the picker.
- **Rendering:** its own shadow root, with `pageStyles`' field rules and `pickerStyles`,
  holding an `<antrea-namespace-picker>` bound to `state.access`, `scope`, `offerAll` and
  `note`, plus `error` as an inline message. The plugin's styles can't break it, and it
  doesn't depend on them. Theming uses the existing `--antrea-color-*` custom properties,
  which pass through shadow boundaries.
- **Output:** a `scope` property (read-only, `NamespaceScopeState`), and an
  `antrea-namespace-scope-state` event (`detail: NamespaceScopeState`) on every change. It
  bubbles, but is not composed: it is for the plugin, not the host.
- **Host events:** `antrea-namespace-scope-chosen` / `-change` / `antrea-session-expired` are
  dispatched from the element and are already bubbling and composed. They cross the plugin's
  shadow root and reach the plugin element, where the host listens. The plugin doesn't need to
  forward anything.
- **Lifecycle:** it creates the handle in `connectedCallback` and disposes it in
  `disconnectedCallback`.

Plugin usage (Lit):

```ts
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { registerRoute, namespaceScopeSupported } from '@antrea/ui-plugin-sdk';
import type { NamespaceScopeState } from '@antrea/ui-plugin-sdk';

const PODS = [{ group: '', resource: 'pods', verb: 'list' }];

class PodsPage extends LitElement {
    @property({ attribute: false }) locationSearch?: string;
    @state() private scope: NamespaceScopeState | null = null;

    render() {
        return html`
            <antrea-namespace-scope .locationSearch=${this.locationSearch} .resources=${PODS}
                @antrea-namespace-scope-state=${(e: CustomEvent<NamespaceScopeState>) => {
                    this.scope = e.detail;
                    void this.load();
                }}></antrea-namespace-scope>
            ...`;
    }
}
customElements.define('pods-page', PodsPage);
registerRoute({ path: '/plugin/pods', tag: 'pods-page',
    requires: { namespaceScope: true, resources: PODS } });
```

Headless usage, for a plugin with its own picker or no Lit:

```ts
import { namespaceScope } from '@antrea/ui-plugin-sdk';

connectedCallback() {
    this.handle = namespaceScope().create({ target: this, resources: PODS });
    this.unsubscribe = this.handle.subscribe(s => this.render(s));
    this.handle.setLocationSearch(this.locationSearch);
}
set locationSearch(v) { this._search = v; this.handle?.setLocationSearch(v); }
disconnectedCallback() { this.unsubscribe(); this.handle.dispose(); }
```

### Host and SDK surface

`plugin-access.ts` has `createPluginHostAccess()`. In the same way, add a host-agnostic
factory to `@antrea/ui-components`, so the React host and the downstream Angular host publish
the same object:

```ts
// lib/plugin-namespace-scope.ts
export interface PluginNamespaceScope {
    create(options: NamespaceScopeOptions): NamespaceScopeHandle;
    /** The query string that carries `scope` to another Namespace-aware page, for links. */
    search(scope: NamespaceScope | null): string;
}
export function createPluginNamespaceScope(): PluginNamespaceScope;
```

- **Host** ([plugins.ts](client/web/antrea-ui/src/plugins.ts)): add
  `namespaceScope: createPluginNamespaceScope()` to `window.__antreaPluginHost`.
- **SDK** ([index.ts](client/web/antrea-ui-plugin-sdk/src/index.ts)):
  - Add `namespaceScope?: PluginNamespaceScope` to `AntreaPluginHost`. It is optional, like
    `access`, so a plugin can detect an older host.
  - Add `export function namespaceScope(): PluginNamespaceScope`, which throws on an older
    host, the same as `access()`.
  - Add `export function namespaceScopeSupported(): boolean`. It checks both
    `host().namespaceScope` and `customElements.get('antrea-namespace-scope')`, so a plugin can
    fall back to a plain page.
  - Re-export the types `NamespaceScope`, `NamespaceScopeState`, `NamespaceScopeOptions`,
    `NamespaceScopeHandle`, `NamespaceAccess`, `ScopeNote` and `ScopeSelectDetail`, plus a
    `declare global { interface HTMLElementTagNameMap { 'antrea-namespace-scope': ... } }`
    augmentation so `lit-plugin` and `tsc` check the tag. The SDK stays types-only.
- **Index** ([index.ts](client/web/antrea-ui-components/src/index.ts)): export the controller,
  the element and the types for the hosts.

`resources` is passed explicitly rather than taken from the route's `requires`. The element
doesn't know which route or tab mounted it, and Flow Visibility shows that a page's verdict can
change while it is open. The docs tell authors to pass the same list as `requires.resources`.

### Native Federation pages

Federated routes (`federation.routes`) exist only in the out-of-tree Angular shell
(cayman_antrea-ui, `antrea-ui-angular`). I checked it at `b4c42a3`. It already handles part of
this:

- It sets `window.__antreaPluginHost` (`antrea-ui-angular/src/app/plugins.ts`),
  so a remote can call the SDK's `namespaceScope()` once the shell publishes it.
- It gates `federation.routes[].requires` (including `namespaceScope`), and its synthesized
  sidebar entries carry the last scope.
- It imports `@antrea/ui-components` to render the Lit pages, so `<antrea-namespace-scope>` is
  defined. An Angular component uses it with `CUSTOM_ELEMENTS_SCHEMA`.

What it lacks is the per-route bridge. A federated route goes through `loadComponent` /
`loadChildren` (`app.routes.ts`),
not `PluginPage`. Nothing hands the page `locationSearch`, and nothing listens for its events.
`NamespaceScopedPage`, which does that bridging for custom-element routes, wraps only the
custom element. In an events-only design, that leaves three problems:

1. **The URL write is wrong.** The shell uses `withHashLocation()`, so the router's query is
   inside `#/...?namespace=`. `writeScopeToURL` writes `window.location.search` (before the
   `#`). For custom elements, `NamespaceScopedPage.onScopeChange` repairs this. For a federated
   page nothing does, so the scope lands in the wrong place, and `ActivatedRoute` never sees it.
2. **The last scope is never recorded.** `setLastScope` runs only from the listener on
   `PluginPage`'s element, so sidebar links keep a stale scope.
3. **Session expiry.** `antrea-session-expired` from a federated page has no wrapper element
   to catch it. Check whether the shell's layout catches it anyway.

**Change to the design: a per-host navigation adapter.** The handle that
`window.__antreaPluginHost.namespaceScope` hands out does not dispatch the two scope events.
It calls the host directly:

```ts
/** What a host supplies to createPluginNamespaceScope(). */
export interface NamespaceScopeHostAdapter {
    /** Put `namespace` (a name, '_all', or null to remove it) in the current route's query,
     * replacing the history entry. */
    writeScope(namespace: string | null): void;
    /** Record the last scope chosen for the signed-in user. */
    rememberScope(scope: string): void;
    sessionExpired(): void;
}
export function createPluginNamespaceScope(adapter: NamespaceScopeHostAdapter): PluginNamespaceScope;
```

- **React host:** `writeScope` is `setSearchParams(..., { replace: true })` through a router
  ref, and `rememberScope` is `setLastScope(user, ...)`.
- **Angular shell:** `writeScope` takes `router.parseUrl(router.url)`, sets `namespace` in its
  `queryParams`, and calls `navigateByUrl(tree, { replaceUrl: true })`. That works for a page at
  any depth under a `kind: "routes"` remote, where `navigate([])` without `relativeTo` would go
  to `/`. `rememberScope` is the shell's `setLastScope`. It publishes the adapter once the
  `Router` exists, for example in an `APP_INITIALIZER`.
- **Built-in Lit pages** keep calling `createNamespaceScope()` directly in events mode, so
  `NamespaceScopedPage` and the React `useNamespaceScope` keep working unchanged.
- **No double handling.** On a custom-element plugin route, the host's per-element listener
  receives nothing from an adapter-mode handle, so each write and record happens exactly once.
  Hand-wired plugin pages that dispatch the events themselves still work.

A federated page then feeds the handle its URL from the router itself:

```ts
@Component({ /* ... */ schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<antrea-namespace-scope [locationSearch]="search()" [resources]="pods"
               (antrea-namespace-scope-state)="onScope($event)"></antrea-namespace-scope>` })
export default class PodsPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly pods = [{ group: '', resource: 'pods', verb: 'list' }];
  // The same derivation NamespaceScopedPage.locationSearch uses.
  protected readonly search = toSignal(this.route.queryParamMap.pipe(map(q =>
    `?${new URLSearchParams(q.getAll('namespace').map(n => ['namespace', n]))}`)));
}
```

A page that wants a Clarity-native picker instead uses `namespaceScope().create(...)` and binds
`state().access` to its own `clr-combobox`. Rule 11 allows this.

**Don't rely on the shared singleton.** The shell's `federation.config.mjs` uses `shareAll`, and
its `remoteEntry.json` shares `@antrea/ui-components` 0.1.0 (singleton, `strictVersion`). A
remote that also shares it would get the shell's module instance, and the module-state problem
(1 above) would not apply. Don't make that the contract. It works only while both sides build
against the same unpublished `0.1.0` tgz, a version bump breaks it with `strictVersion`, and
the React host has no federation at all. `window.__antreaPluginHost` is the one interface that
works in both hosts.

### Overview tabs

A plugin Overview tab gets `locationSearch` too, and the host's `tabSearch` keeps `namespace`
across tabs. With this design, a tab renders its own `<antrea-namespace-scope>`, so switching
tabs keeps the scope but each tab shows its own picker. That matches how the built-in tab
works today (its picker is inside `antrea-overview-page`). See open question 2.

## Alternatives considered

- **Plugin bundles `@antrea/ui-components` pieces.** Rejected: module state is duplicated and
  the Namespace list survives sign-out (problem 1), and `apiBase` is not set.
- **Expose only `NamespaceAccess` and the styles, and let plugins wire the rest.** This is a
  smaller surface, but every plugin re-implements rules 5, 6, 8 and 12 and drifts as they
  change (problem 4). It is still possible through A for authors who want it.
- **The host renders the picker itself, above any `namespaceScope` page, and passes the scope
  down as a property.** This gives the most consistency and needs no plugin code. Rejected for
  now: the page loses control over where the picker goes and its per-page verdict (follow/list).
  Rule 6 notes and errors would need a channel back. It would differ from Overview and Flow
  Visibility, whose pickers sit in their toolbars. Both hosts would have to implement it. It is
  worth revisiting if the built-in pages ever move their pickers into a shared page header.

## Compatibility

- This is additive. Plugins that already follow the `docs/plugins.md` contract by hand keep
  working.
- A plugin that uses it needs `compatibleAntreaUI` raised to the release that ships it, and
  should check `namespaceScopeSupported()` before rendering the tag. On an older host the tag
  stays an unknown element and renders nothing.
- The Angular shell already bridges the two scope events for custom-element plugin routes
  (`NamespaceScopedPage`). It has to publish `createPluginNamespaceScope()` with its adapter
  (see "Native Federation pages"). Without that, federated pages can't use any of this.

## Plan

1. **Extract the controller (refactor, no behavior change).** Add
   `namespace-scope-controller.ts` with unit tests (Vitest + jsdom; use fake timers or
   `vi.waitFor` only where a fetch resolves, since this is TS and `synctest` doesn't apply).
   Move Overview onto it. The existing Overview tests must pass unchanged.
2. **Move Flow Visibility onto it.** Use `setResources` for follow/list and keep the
   filter-menu reset in the page's subscriber.
3. **Expose it to plugins.** Add the `<antrea-namespace-scope>` element,
   `createPluginNamespaceScope()`, the host wiring, the SDK functions and types, and the
   `docs/plugins.md` section ("Using the Namespace picker"). Shorten the hand-written contract
   to "or use `<antrea-namespace-scope>`". Also add a namespaced example (extend `pod-counter`
   or add a new one).

Step 3 depends only on step 1. Step 2 can land in parallel with or after step 3.

## Tests

- **Controller:** URL scope used before access loads; invalid URL leads to error and null;
  default waits for access and is neither reported nor written; typed invalid name is
  rejected; `select()` writes the URL and dispatches change+chosen once; own echo ignored;
  Back/Forward via `setLocationSearch` re-applies; re-report after mount; 401 leads to
  `antrea-session-expired`; `dispose()` stops pending note/access work; sign-out
  (`resetAccessSummary`) leads to a fresh list on the next `create`.
- **Element:** renders a styled picker in its own shadow root; host events cross the plugin's
  shadow root and reach an outer listener; `antrea-namespace-scope-state` is not composed.
- **Host** ([pages.test.tsx](client/web/antrea-ui/src/pages.test.tsx)): a plugin route with
  `namespaceScope` that renders `<antrea-namespace-scope>` with `?namespace=foo` sets the last
  scope, and a pick updates the router location and the sidebar link.
- **SDK:** `namespaceScope()` throws on a host without it; `namespaceScopeSupported()` is
  false without the element.
- Mutation-check the new tests (break the rule, see the test fail).

## Open questions

1. **Element name.** `antrea-namespace-scope` (scope plus picker) or
   `antrea-plugin-namespace-picker`. I prefer the first, since the built-in pages could use it
   too.
2. **Overview tabs.** Keep one picker per tab, or have the Overview host render one picker
   above all tabs? One picker reads better for the ANS Security tab, but it moves the built-in
   tab's picker out of its toolbar and is a UX change.
3. **Angular shell.** The adapter interface, `createPluginNamespaceScope()` and the React
   adapter are upstream. The Angular adapter is downstream, in cayman_antrea-ui's
   `antrea-ui-angular`, after it picks up the upstream change. Who does it, and does it ship in
   the same release? Does `antrea-session-expired` from a federated page reach the
   shell's session handling today?
4. **Programmatic links.** Is `search(scope)` enough for a plugin to link to Overview or Flow
   Visibility with a scope, or should we also expose a `navigate(path, scope)` helper (the
   host has `navigateTo`)?
