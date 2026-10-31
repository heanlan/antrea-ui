// Copyright 2026 Antrea Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AccessSummary } from './access-api';
import { createPluginHostAccess, meetsAccessRequirements, parseAccessRequirements } from './plugin-access';

const PODS_LIST = { group: '', resource: 'pods', verb: 'list' };

function summary(overrides: Partial<AccessSummary> = {}): AccessSummary {
    return {
        username: 'alice', groups: [], clusterAdmin: false, namespaces: ['team-a'],
        rules: { resourceRules: [{ verbs: ['list'], apiGroups: [''], resources: ['pods'] }], nonResourceRules: [], incomplete: false },
        ...overrides,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('parseAccessRequirements', () => {
    test('no requirement means ungated', () => {
        expect(parseAccessRequirements(undefined, 'x')).toEqual([]);
        expect(parseAccessRequirements(null, 'x')).toEqual([]);
    });

    test('a well-formed requirement is kept as-is', () => {
        const requirement = { clusterAdmin: true, resources: [{ ...PODS_LIST, name: 'p' }] };
        expect(parseAccessRequirements(requirement, 'x')).toEqual([requirement]);
    });

    test.each([
        ['a string', 'clusterAdmin'],
        ['an unknown requirement key', { clusterAdmn: true }],
        ['a misspelled requirement beside a valid one', { clusterAdmn: true, resources: [PODS_LIST] }],
        ['an unknown resource query key', { resources: [{ ...PODS_LIST, names: ['p'] }] }],
        ['an array', [{ clusterAdmin: true }]],
        ['a non-boolean clusterAdmin', { clusterAdmin: 'true' }],
        ['a non-array resources', { resources: PODS_LIST }],
        ['a query missing its verb', { resources: [{ group: '', resource: 'pods' }] }],
        ['a query with an empty resource', { resources: [{ group: '', resource: '', verb: 'list' }] }],
    ])('%s is logged and denies', (_name, requires) => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const requirements = parseAccessRequirements(requires, 'sidebar entry "/x"');

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('sidebar entry "/x" has a malformed "requires"'));
        expect(meetsAccessRequirements(summary({ clusterAdmin: true }), requirements)).toBe(false);
        expect(meetsAccessRequirements(null, requirements)).toBe(false);
    });
});

describe('meetsAccessRequirements', () => {
    test('clusterAdmin passes only for cluster admins', () => {
        expect(meetsAccessRequirements(summary(), [{ clusterAdmin: true }])).toBe(false);
        expect(meetsAccessRequirements(summary({ clusterAdmin: true }), [{ clusterAdmin: true }])).toBe(true);
    });

    test('every resource query must be allowed', () => {
        expect(meetsAccessRequirements(summary(), [{ resources: [PODS_LIST] }])).toBe(true);
        expect(meetsAccessRequirements(summary(), [{ resources: [PODS_LIST, { group: '', resource: 'services', verb: 'list' }] }])).toBe(false);
    });

    test('every requirement in the list must hold', () => {
        expect(meetsAccessRequirements(summary(), [{ resources: [PODS_LIST] }, { clusterAdmin: true }])).toBe(false);
    });

    test('incomplete rules leave an unmatched query allowed, like can()', () => {
        const s = summary({ rules: { resourceRules: [], nonResourceRules: [], incomplete: true } });
        expect(meetsAccessRequirements(s, [{ resources: [{ group: '', resource: 'secrets', verb: 'list' }] }])).toBe(true);
    });

    test('a failed summary fetch fails open', () => {
        expect(meetsAccessRequirements(null, [{ clusterAdmin: true, resources: [PODS_LIST] }])).toBe(true);
    });

    test('no requirements always pass', () => {
        expect(meetsAccessRequirements(summary(), [])).toBe(true);
        expect(meetsAccessRequirements(summary(), undefined)).toBe(true);
        expect(meetsAccessRequirements(summary(), [{}])).toBe(true);
    });
});

describe('createPluginHostAccess', () => {
    test('before the host has published, nothing is known and ready() waits', async () => {
        const { access, publish } = createPluginHostAccess();
        let resolved: AccessSummary | null | undefined;
        void access.ready().then(s => { resolved = s; });
        await Promise.resolve();

        expect(access.loaded()).toBe(false);
        expect(access.summary()).toBeNull();
        expect(resolved).toBeUndefined();

        const s = summary();
        publish(true, s);
        await Promise.resolve();
        expect(resolved).toBe(s);
        await expect(access.ready()).resolves.toBe(s);
    });

    test('answers from the published summary', () => {
        const { access, publish } = createPluginHostAccess();
        publish(true, summary());

        expect(access.can(PODS_LIST)).toBe(true);
        expect(access.can({ group: '', resource: 'secrets', verb: 'list' })).toBe(false);
        expect(access.verdict({ group: '', resource: 'secrets', verb: 'list' })).toBe('denied');
        expect(access.isClusterAdmin()).toBe(false);
        expect(access.accessibleNamespaces()).toEqual(['team-a']);
        expect(access.meets({ resources: [PODS_LIST] })).toBe(true);
        expect(access.meets({ clusterAdmin: true })).toBe(false);

        publish(true, summary({ clusterAdmin: true }));
        expect(access.isClusterAdmin()).toBe(true);
        expect(access.meets({ clusterAdmin: true })).toBe(true);
    });

    test('meets() denies a malformed requirement', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { access, publish } = createPluginHostAccess();
        publish(true, summary({ clusterAdmin: true }));

        expect(access.meets({ clusterAdmin: 'yes' } as never)).toBe(false);
    });

    test('subscribers hear about changes until they unsubscribe', () => {
        const { access, publish } = createPluginHostAccess();
        const listener = vi.fn();
        const unsubscribe = access.subscribe(listener);
        const s = summary();

        publish(true, s);
        publish(true, s); // no change, no call
        expect(listener).toHaveBeenCalledExactlyOnceWith(s);

        unsubscribe();
        publish(false, null);
        expect(listener).toHaveBeenCalledOnce();
    });

    test('a throwing subscriber does not stop the others', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { access, publish } = createPluginHostAccess();
        const second = vi.fn();
        access.subscribe(() => { throw new Error('boom'); });
        access.subscribe(second);

        publish(true, summary());
        expect(second).toHaveBeenCalledOnce();
    });

    test('forNamespace() returns the rules for that Namespace, or null on failure', async () => {
        const { access, publish } = createPluginHostAccess();
        publish(true, summary());
        const rules = { resourceRules: [], nonResourceRules: [], incomplete: false };
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [{ namespace: 'team-a', rules, evaluationFailed: false }] })));
        vi.stubGlobal('fetch', fetchMock);

        await expect(access.forNamespace('team-a')).resolves.toEqual({ namespace: 'team-a', rules, evaluationFailed: false });
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/api/v1/access-summary/namespaces?namespace=team-a');

        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
        await expect(access.forNamespace('team-b')).resolves.toBeNull();
    });
});
