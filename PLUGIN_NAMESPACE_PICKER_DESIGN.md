# Exposing the Namespace picker to plugins

Follow-up to plugin permission gating (#1560). The branch started from
`upstream/main` at `6e7b4e68`; implementation status and verification are in
[PLUGIN_NAMESPACE_PICKER_PROGRESS.md](PLUGIN_NAMESPACE_PICKER_PROGRESS.md).

## Goal

A plugin route or Overview tab that declares `namespaceScope: true` can use the
same Namespace picker, default order, URL handling and last-scope bookkeeping as
Overview and Flow Visibility. Authors should not reimplement
[namespace-scope-ux.md](docs/design/namespace-scope-ux.md).

The picker remains a hint: the API authorizes requests, and plugins handle 403s.
This change preserves the current scope rules. Settings defaults and stars are
future work shared by every consumer of the controller.

## Ownership

The scope logic and Namespace list run in the host's `@antrea/ui-components`
instance. A separately built plugin would otherwise have its own API base and
cache, which the host could not reset on sign-out. Importing the components root
at runtime also tries to register custom elements that the host already defined.

Plugins therefore use the host-defined `<antrea-namespace-scope>` tag or the SDK's
`namespaceScope()` wrapper over `window.__antreaPluginHost.namespaceScope`.
Component types are imported only as types. Native Federation sharing is not a
requirement: independently bundled plugins and both frontend hosts use this same
interface.

There are two layers:

- A framework-independent controller owns the scope rules.
- A styled element combines that controller with the existing Namespace picker.

The host owns routing, the signed-in user's last scope and session expiry. The
plugin owns its data requests, cancellation, loading state and API errors.

## Shared controller

`client/web/antrea-ui-components/src/lib/namespace-scope-controller.ts` implements
`createNamespaceScope()`. Overview and Flow Visibility use it directly; the
plugin factory creates the same controller with a host navigation adapter.

```ts
export type NamespaceScope =
    | { kind: 'all' }
    | { kind: 'namespace'; namespace: string };

export type NamespaceScopeResources = ResourceQuery[] | { anyOf: ResourceQuery[] };

export interface NamespaceScopeOptions {
    target: EventTarget;
    resources?: NamespaceScopeResources;
}

export interface NamespaceScopeHandle {
    state(): NamespaceScopeState;
    subscribe(listener: (state: NamespaceScopeState) => void): () => void;
    setLocationSearch(search: string | undefined): void;
    select(scope: NamespaceScope, typed?: boolean): void;
    setResources(resources: NamespaceScopeResources | undefined): void;
    refreshAccess(): void;
    dispose(): void;
}
```

The state contains:

- `scope`: the tagged scope above, or null while loading, for an invalid URL or
  when there is nothing to select.
- `source`: `url`, `picker`, `default` or null; only URL and picker scopes are
  explicit choices remembered by the host.
- `access`: `NamespaceAccess`, or null until its verdict and list are ready.
- `error`: an invalid URL or rejected typed-name message.
- `note`: the note for a selected Namespace missing from a complete nonempty list.
- `offerAll`: whether All Namespaces is offered or is already selected.

The public tagged scope keeps the internal `__cluster_wide__` sentinel out of
plugin code. A `kind: 'namespace'` value is validated as a Namespace name even if
its string happens to equal that sentinel.

### URL and defaults

Call `setLocationSearch()` initially and whenever the host's query changes. A
valid URL scope applies immediately without waiting for access; an invalid one
produces an error and no scope. With no URL scope, the controller waits for the
list and verdict, then chooses All Namespaces only when allowed, otherwise the
first candidate. A default is neither written to the URL nor remembered.

An undefined search reads `window.location.search` and follows `popstate`; a
router host should pass its own query string explicitly. Equivalent query strings
are ignored regardless of parameter order, including the echo of a picker write.
A URL scope is reported again in a microtask after mount so listeners or the host
adapter have time to attach.

### Changing permissions

`resources` is any-of, as on Namespace-aware plugin routes, in either array or
`{ anyOf }` form. Without resources, the verdict is allowed for a cluster admin
and unknown otherwise. Resources are explicit because pages can switch between
operations, such as watching and listing flows.

`setResources()` immediately invalidates the previous verdict and clears a
default scope before asynchronously computing the next one. An explicit URL or
picker choice stays selected. Equivalent resources from a fresh render do not
invalidate anything. A generation guard discards superseded results.

Flow Visibility changes resources when its query switches between watch and list.
It applies query and URL changes together before opening a stream; scope changes
also close filter menus. Its stream request identity still prevents equivalent
state updates from restarting a query.

### Lifecycle and session handling

Subscriptions report every state change, including access, errors and notes.
Consumers compare the effective scope before loading data; a state notification
alone is not a request to fetch again. Subscribe before the first
`setLocationSearch()`, and dispose when the page leaves. Disposal removes listeners
and ignores pending work. A new controller after sign-out uses the host's reset
access-summary and Namespace-list caches.

A 401 from the access summary reports session expiry. The host-only
`NamespaceScopeControllerOptions` adds `adapter`, `onSessionExpired` and
`isActive`; Overview uses the latter two to preserve its session and hidden-tab
behavior. They are not part of plugin options, and the plugin factory accepts
only `target` and `resources`, preserving the host's adapter even for untyped
callers.

## Host navigation adapter

```ts
export interface NamespaceScopeHostAdapter {
    writeScope(namespace: string | null): void;
    rememberScope(scope: string): void;
    sessionExpired(): void;
}

export interface PluginNamespaceScope {
    create(options: NamespaceScopeOptions): NamespaceScopeHandle;
    search(scope: NamespaceScope | null): string;
}

export function createPluginNamespaceScope(
    adapter?: NamespaceScopeHostAdapter,
): PluginNamespaceScope;
```

`writeScope` replaces the current route's `namespace` query parameter, keeping its
other parameters: a Namespace name, `_all`, or null to remove it. `rememberScope`
stores the URL-form value for the signed-in user. `search(scope)` builds a query
string for links to another Namespace-aware page.

There are two integration modes:

- **Adapter mode**, used by the plugin API: calls the host directly for scope
  writes, remembering choices and session expiry, without dispatching those
  events or modifying browser history itself.
- **Events mode**, used by built-in pages and available to other component hosts:
  writes through the existing URL helper and dispatches bubbling, composed scope
  events; the existing per-element host listeners adopt the URL and record scope.

Manual plugins using the original event contract remain supported. A plugin using
the element or headless API does not forward these events.

### React

`pluginScope.ts` publishes a stable adapter. `PluginScopeBridge`, mounted in the
authenticated shell, binds it to `setSearchParams(..., { replace: true })`,
`setLastScope(user, scope)` and logout. It clears those bindings on unmount.
Custom-element plugin routes and Overview tabs already receive `locationSearch`.

### Downstream Angular and Native Federation

The upstream factory supplies the interface, but the downstream Angular shell
must publish its own adapter before mounting plugins. This branch does not itself
implement or verify that downstream integration.

For the hash router, derive a URL tree from `router.url`, update its
`queryParams.namespace`, and call `navigateByUrl(tree, { replaceUrl: true })`.
This preserves the current nested route and places the query inside the hash.
Wire remembering to the shell's signed-in user and session expiry directly to its
logout handling. Do not rely on a federated page's events reaching a wrapper:
federated routes are loaded through Angular routing, not the custom-element host.

Federated pages feed the element or handle the query string derived from their
`ActivatedRoute`, including duplicate Namespace parameters so invalid URLs remain
invalid. An Angular template uses `CUSTOM_ELEMENTS_SCHEMA`; a Clarity-native
picker can instead use the headless API.

Acceptance checks downstream are a nested federated route, Back/Forward, query
preservation, last-scope sidebar links, 401 handling and user changes in one tab.

## Styled element and SDK

`<antrea-namespace-scope>` creates and disposes a handle with its own connection.
It uses the published host factory when available and events mode otherwise.
Its own shadow root contains the existing picker and its field/combobox styles,
so plugin styles are not required; theme custom properties cross the boundary.

Properties are `locationSearch`, `resources`, `label` and `inputId`. Its read-only
`scope` property holds the full state, or null before connection. The
`antrea-namespace-scope-state` event reports that state and bubbles without being
composed, remaining inside a containing plugin shadow root.

The SDK exports the public types, tag typing, `namespaceScope()` and
`namespaceScopeSupported()`. The latter checks both the host API and tag
registration. A plugin checks support and sets `compatibleAntreaUI` to a release
that provides the API; calling `namespaceScope()` on an older host throws.

The [Pod Counter example](plugins/examples/pod-counter/src/index.ts) is the complete
custom-element consumer: it shares its resources with route registration, passes
`locationSearch`, loads only on an effective scope change, cancels old requests,
ignores late results, preserves the picker on 403, and supports explicit retry.
The author-facing contract and a shorter example are in [docs/plugins.md](docs/plugins.md).

## Scope of the UI change

A plugin Overview tab renders its own picker in its toolbar, just as the built-in
tab does. The host preserves `namespace` when switching tabs. A single picker
above all Overview tabs would be a separate host layout change, with a channel
for each tab's permissions and notes; it is not required for this shared API.

`search(scope)` covers scoped links. A router-level `navigate(path, scope)` API is
not added here. Settings defaults and stars should be added to the shared logic
when those features are implemented, so all three consumers receive the same
behavior.

## Verification

Controller coverage includes URL-first selection, invalid values, defaults,
typed-name validation, URL echoes, Back/Forward, mount reporting, 401, disposal,
sign-out cache reset, resource changes and the host-only option boundary.

Element coverage checks styles in its shadow root, event boundaries, both
resource forms and simultaneous resource/URL changes. Overview and Flow Visibility
retain their existing tests, including watch/list transitions and explicit scopes.
Host tests exercise router/last-scope wiring and the real Pod Counter's requests,
refusals, retries and cancellation. The standalone example is built independently.

See the progress file for results of checks actually run and remaining work.
