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

import { useEffect, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useScopeUser } from './access';
import { useLogout } from './logout';
import { setLastScope } from './lastScope';
import { bindPluginScope } from './pluginScope';

// Connects the plugin Namespace scope API (see pluginScope.ts) to the router, the signed-in user
// and the logout. Renders nothing. A layout effect, so that it is bound before the plugin element
// the same commit mounts reports its scope.
export function PluginScopeBridge() {
    const [, setSearchParams] = useSearchParams();
    const user = useScopeUser();
    const logout = useLogout();
    useLayoutEffect(() => {
        bindPluginScope({
            writeScope: namespace => setSearchParams(prev => {
                const next = new URLSearchParams(prev);
                if (namespace === null) next.delete('namespace');
                else next.set('namespace', namespace);
                return next;
            }, { replace: true }),
            rememberScope: scope => setLastScope(user, scope),
            sessionExpired: () => { void logout('Your session has expired. Please log in again.'); },
        });
    }, [setSearchParams, user, logout]);
    useEffect(() => () => bindPluginScope(null), []);
    return null;
}
