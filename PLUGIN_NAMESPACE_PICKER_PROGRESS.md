# Plugin Namespace picker: implementation progress

Branch `plugin-namespace-picker`, originally based on `upstream/main` at
`6e7b4e68`. Implements [PLUGIN_NAMESPACE_PICKER_DESIGN.md](PLUGIN_NAMESPACE_PICKER_DESIGN.md).

## Completed upstream

- **Shared controller:** URL/default selection, typed-name validation, scope notes,
  mount reporting, disposal and session expiry, with events and host-adapter modes.
- **Permission changes:** synchronously invalidate the previous verdict and default,
  preserve explicit choices, ignore equivalent resource arrays, and discard superseded
  asynchronous results; both arrays and `{ anyOf }` resource declarations are accepted.
- **Public scope values:** invalid Namespace names cannot become All Namespaces through
  selection or the link helper.
- **Plugin API boundary:** public options contain only target and resources; host adapter
  and internal lifecycle options cannot be replaced by plugin arguments.
- **Styled element:** its own shadow root, a bubbling/non-composed state event and
  resource updates applied before a changed URL can choose a default.
- **Built-in pages:** Overview and Flow Visibility both use the controller; Flow Visibility
  changes resources for watch/list, preserves filter-menu behavior and reconciles simultaneous
  query/URL changes before opening a stream.
- **React host and SDK:** router, last-scope and logout adapter; published host API,
  capability detection, public types and tag typing.
- **Pod Counter example:** uses the host picker, requests the selected scope, avoids repeat
  loads on note/access updates, aborts stale work, handles 401/403 and supports explicit retry.
- **Documentation:** design consolidated around the current adapter contract; plugin guide
  distinguishes the element/headless API from manual event wiring and documents resource forms
  and the data-loading lifecycle.

## Remaining downstream

- Publish the Angular adapter in `cayman_antrea-ui` / `antrea-ui-angular` before mounting
  plugins, using its router, signed-in user and logout handling.
- Exercise nested federated routes, Back/Forward, query preservation, sidebar scope,
  session expiry and user changes with that adapter.
- The downstream repository has not been supplied for this implementation pass, so that
  integration has not been changed or verified.

A shared picker above Overview tabs, Settings defaults and stars remain separate UI work;
this branch provides the shared controller where their scope behavior can be added.

## Verification

Verified locally on 2026-11-19:

- Full components suite: **804 tests passed**.
- Full React host suite: **201 tests passed**, including the real Pod Counter consumer.
- Both frontend ESLint checks passed.
- Components TypeScript check and build, SDK build, and React host production build passed.
- Standalone Pod Counter TypeScript check and bundle build passed.
- The host tests and production build also passed with the example's own `node_modules`
  absent, matching the frontend CI setup.
- Live Chromium smoke test against local kind cluster `flowbench-pr1575`: **13 checks
  passed**, using locally built frontend/backend images and the bundled Pod Counter plugin.
  Verified cluster-wide and namespace-specific counts, URL/query preservation, reload,
  sidebar navigation, Back/Forward, invalid URLs without data requests, restricted-user
  defaults, real Kubernetes 403 responses without scope fallback, explicit retry after
  granting RBAC access, user changes, and a real 401 after removing the session cookie.
  No uncaught browser errors occurred. Login retries respected the backend's `Retry-After`
  response. The test used isolated namespaces and prefixed cluster RBAC resources.
  All test resources were removed afterward; the existing Antrea UI deployment remained
  healthy with its original images.
- `git diff --check` passed.

The picker-style test now accepts both adopted stylesheets and Lit's `<style>` fallback.
No downstream Angular application was exercised.
