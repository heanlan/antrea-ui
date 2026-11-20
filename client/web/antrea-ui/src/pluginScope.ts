/**
 * Copyright 2026 Antrea Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// How the React host serves window.__antreaPluginHost.namespaceScope: the scope controller calls
// this adapter, which reaches the router and the signed-in user through bindings that
// PluginScopeBridge (inside the router) keeps current. Until it has bound them a call does
// nothing, which is why a controller reports a URL scope again once mounted.

import { createPluginNamespaceScope } from '@antrea/ui-components';
import type { NamespaceScopeHostAdapter } from '@antrea/ui-components';

export interface PluginScopeBindings {
    /** Puts `namespace` in the current route's query ('_all', a name, or null to remove it). */
    writeScope(namespace: string | null): void;
    rememberScope(scope: string): void;
    sessionExpired(): void;
}

let bindings: PluginScopeBindings | null = null;

export function bindPluginScope(next: PluginScopeBindings | null): void {
    bindings = next;
}

const adapter: NamespaceScopeHostAdapter = {
    writeScope: namespace => bindings?.writeScope(namespace),
    rememberScope: scope => bindings?.rememberScope(scope),
    sessionExpired: () => bindings?.sessionExpired(),
};

export const pluginNamespaceScope = createPluginNamespaceScope(adapter);
