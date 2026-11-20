# Plugin Namespace picker: implementation progress

Branch `plugin-namespace-picker`, based on `upstream/main` at `6e7b4e68`. Implements
[PLUGIN_NAMESPACE_PICKER_DESIGN.md](PLUGIN_NAMESPACE_PICKER_DESIGN.md).

## Done

- **Controller** (`antrea-ui-components/src/lib/namespace-scope-controller.ts`): all page-side
  scope rules in one framework-agnostic place. Events mode (dispatches the scope events from a
  target) and adapter mode (calls the host directly). 24 tests.
- **Helpers** in `lib/namespace-scope.ts`: `NamespaceScope`, `scopeToValue`, `valueToScope`,
  `searchWithScope`.
- **Element** `<antrea-namespace-scope>` (`src/antrea-namespace-scope.ts`): own shadow root and
  styles, `antrea-namespace-scope-state` event (bubbles, not composed). 7 tests.
- **Factory** `createPluginNamespaceScope(adapter?)` (`lib/plugin-namespace-scope.ts`).
- **Overview page** moved onto the controller. Its existing tests pass unchanged.
- **React host**: `pluginScope.ts` (adapter), `PluginScopeBridge.tsx` (binds router, user and
  logout; mounted in `AuthShell`), `namespaceScope` published on `window.__antreaPluginHost`.
  Host test in `pages.test.tsx`.
- **SDK**: `namespaceScope()`, `namespaceScopeSupported()`, types, tag augmentation. Tested in
  `antrea-ui/src/pluginSdk.test.ts` (the SDK package has no test runner).
- **Docs**: "Using the Namespace picker" section in `docs/plugins.md`.

## Deviations from the design

- The controller repeats the URL-scope report after mount in adapter mode too: the React bridge
  binds in a layout effect, which can run after the first report.
- Echo detection compares query strings regardless of parameter order, since routers reorder.
- Two internal controller options, `onSessionExpired` and `isActive`, keep Overview's existing
  401 and hidden-tab behavior. They are not for plugins.

## Not done

- **Flow Visibility** still has its own copy of the scope logic (`_clusterWide`, `_observedNs`,
  follow/list verdict through `setResources`, filter-menu reset). Plan step 2.
- **Example plugin** using the picker (extend `pod-counter` or add one). Plan step 3.
- **Angular adapter** in cayman_antrea-ui (downstream), and whether
  `antrea-session-expired` from a federated page reaches the shell's session handling.
- `make markdownlint` target was not available locally, so the markdown is unlinted.

## Verification

components 794 tests, host 196 tests, `tsc -b` and `eslint` clean. Controller tests were
mutation-checked (default order, echo-ignore, typed-name validation, mount re-report).
