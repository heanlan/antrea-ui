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

// Permission gating for plugins, shared by every host: the `requires` a plugin can put on a
// route, sidebar entry or Overview tab, and the access API a host exposes to plugin code as
// window.__antreaPluginHost.access. @antrea/ui-plugin-sdk re-exports the types; hosts use the
// functions. See docs/plugins.md ("Permission gating").

import {
    accessibleNamespaces, can, namespaceAccessSummaries, verdict,
    type AccessSummary, type NamespaceAccessSummary, type ResourceQuery, type Verdict,
} from './access-api.js';

/** Who may see a plugin item. Every condition set must hold. Mirrors the Go
 * PluginAccessRequirement in apis/v1/plugins.go, which carries it on manifest routes. */
export interface PluginAccessRequirement {
    /** true: only users whose access summary reports clusterAdmin. */
    clusterAdmin?: boolean;
    /** Every query must pass can(): an unknown verdict counts as passing, as for the built-in pages. */
    resources?: ResourceQuery[];
}

// Stands in for a malformed requirement and always denies: its author meant to restrict the
// item, so a typo must not show it to everyone.
const INVALID: PluginAccessRequirement = Object.freeze({});

function isResourceQuery(value: unknown): value is ResourceQuery {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    if (Object.keys(value).some(key => !['group', 'resource', 'verb', 'name'].includes(key))) return false;
    const q = value as { group?: unknown; resource?: unknown; verb?: unknown; name?: unknown };
    return typeof q.group === 'string' && typeof q.resource === 'string' && q.resource !== ''
        && typeof q.verb === 'string' && q.verb !== ''
        && (q.name === undefined || typeof q.name === 'string');
}

function isRequirement(value: unknown): value is PluginAccessRequirement {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    if (Object.keys(value).some(key => !['clusterAdmin', 'resources'].includes(key))) return false;
    const r = value as { clusterAdmin?: unknown; resources?: unknown };
    if (r.clusterAdmin !== undefined && typeof r.clusterAdmin !== 'boolean') return false;
    return r.resources === undefined || (Array.isArray(r.resources) && r.resources.every(isResourceQuery));
}

/**
 * Turns a plugin-supplied `requires` value into the list of requirements a host stores with the
 * item (all must hold). Absent means ungated (an empty list). A malformed value is logged, naming
 * `what`, and replaced with a requirement that always denies.
 */
export function parseAccessRequirements(requires: unknown, what: string): PluginAccessRequirement[] {
    if (requires === undefined || requires === null) return [];
    if (isRequirement(requires)) return [requires];
    console.error(`plugin ${what} has a malformed "requires" (${JSON.stringify(requires)}), hiding it`);
    return [INVALID];
}

/**
 * Whether `summary` meets every requirement. A null summary (the fetch failed) fails open, like
 * the built-in pages: gating is a UI hint, and Kubernetes RBAC still authorizes every API call a
 * plugin makes. Callers decide what to do before the summary has loaded; hosts hide gated items.
 */
export function meetsAccessRequirements(
    summary: AccessSummary | null,
    requirements: readonly PluginAccessRequirement[] | undefined,
): boolean {
    return (requirements ?? []).every(requirement => {
        if (requirement === INVALID) return false;
        if (summary === null) return true;
        if (requirement.clusterAdmin && !summary.clusterAdmin) return false;
        return (requirement.resources ?? []).every(query => can(summary, query));
    });
}

/** The access API a host exposes to plugin code as window.__antreaPluginHost.access. */
export interface PluginHostAccess {
    /** True once the host has an answer: a summary, or a failed fetch (summary() stays null). */
    loaded(): boolean;
    /** Resolves with summary() once loaded() is true. */
    ready(): Promise<AccessSummary | null>;
    summary(): AccessSummary | null;
    /** Fails open on an unknown verdict or a null summary, like the built-in pages. */
    can(query: ResourceQuery): boolean;
    verdict(query: ResourceQuery): Verdict;
    isClusterAdmin(): boolean;
    /** null means all Namespaces, or unknown. */
    accessibleNamespaces(): string[] | null;
    /** The same evaluation the host applies to a route's, sidebar entry's or tab's `requires`. */
    meets(requirement: PluginAccessRequirement): boolean;
    /** The user's rules in one Namespace, or null if they can't be fetched. */
    forNamespace(namespace: string): Promise<NamespaceAccessSummary | null>;
    /** Called whenever loaded() or summary() changes. Returns an unsubscribe function. */
    subscribe(listener: (summary: AccessSummary | null) => void): () => void;
}

/**
 * Creates a host's PluginHostAccess, plus the `publish` function the host calls whenever its own
 * access state changes, so plugins and the host's nav see the same summary.
 */
export function createPluginHostAccess(): {
    access: PluginHostAccess;
    publish(loaded: boolean, summary: AccessSummary | null): void;
} {
    let loaded = false;
    let summary: AccessSummary | null = null;
    const listeners = new Set<(summary: AccessSummary | null) => void>();
    let readyWaiters: ((summary: AccessSummary | null) => void)[] = [];

    const access: PluginHostAccess = {
        loaded: () => loaded,
        ready: () => loaded ? Promise.resolve(summary) : new Promise(resolve => readyWaiters.push(resolve)),
        summary: () => summary,
        can: query => can(summary, query),
        verdict: query => verdict(summary, query),
        isClusterAdmin: () => summary?.clusterAdmin === true,
        accessibleNamespaces: () => accessibleNamespaces(summary),
        meets: requirement => meetsAccessRequirements(summary, parseAccessRequirements(requirement, 'access.meets() call')),
        forNamespace: async namespace => {
            await access.ready();
            try {
                const list = await namespaceAccessSummaries([namespace]);
                return list.items.find(item => item.namespace === namespace) ?? null;
            } catch (e) {
                console.error(`failed to fetch access summary for Namespace "${namespace}"`, e);
                return null;
            }
        },
        subscribe: listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };

    function publish(nextLoaded: boolean, nextSummary: AccessSummary | null): void {
        if (nextLoaded === loaded && nextSummary === summary) return;
        loaded = nextLoaded;
        summary = nextSummary;
        if (loaded) {
            const waiters = readyWaiters;
            readyWaiters = [];
            for (const resolve of waiters) resolve(summary);
        }
        for (const listener of [...listeners]) {
            try {
                listener(summary);
            } catch (e) {
                console.error('plugin access listener failed', e);
            }
        }
    }

    return { access, publish };
}
