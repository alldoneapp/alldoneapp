import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import firebase from 'firebase/compat/app'

import { shouldUseFirebaseEmulators } from '../../utils/firebaseEmulators'
import {
    createMcpSessionClient,
    getMcpServerEndpoint,
    installBrowserAgentApi,
} from '../../utils/browserAgent/browserAgentApi'
import { ensureWebMcpOriginTrialToken } from '../../utils/browserAgent/webMcpOriginTrial'

/**
 * Exposes the signed-in user's Alldone tools to browser agents (AT-2871): WebMCP when the browser
 * has it, `window.alldone` always. Mounted only inside the logged-in tree; renders nothing.
 *
 * On by default. Settings → MCP → "Browser agents" switches it off (`browserAgentToolsEnabled`), and
 * the MCP master switch switches it off too. The MCP server enforces both as well, so this gate only
 * decides whether the page advertises anything.
 */
export default function BrowserAgentApiBridge() {
    const uid = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => !!state.loggedUser.isAnonymous)
    const enabled = useSelector(
        state => state.loggedUser.mcpEnabled !== false && state.loggedUser.browserAgentToolsEnabled !== false
    )
    // Re-register when the user changes which tools MCP clients may use.
    const disabledToolsKey = useSelector(state =>
        Array.isArray(state.loggedUser.mcpDisabledTools) ? state.loggedUser.mcpDisabledTools.join(',') : ''
    )

    useEffect(() => {
        if (typeof window === 'undefined' || !uid || isAnonymous || !enabled) return undefined

        ensureWebMcpOriginTrialToken()

        const client = createMcpSessionClient({
            endpoint: getMcpServerEndpoint({
                origin: window.location.origin,
                useEmulators: shouldUseFirebaseEmulators(),
                projectId: firebase.apps.length ? firebase.app().options.projectId : '',
            }),
            // Never hand out a token for a different account than the one this page shows.
            getIdToken: async () => {
                const user = firebase.auth().currentUser
                if (!user || user.isAnonymous || user.uid !== uid) return null
                return user.getIdToken()
            },
        })

        const controller = new AbortController()
        let dispose = null
        installBrowserAgentApi({
            win: window,
            client,
            signal: controller.signal,
            onError: (error, toolName) =>
                console.warn('[BrowserAgentApi] WebMCP registration failed', toolName || '', error?.message || error),
        }).then(disposeApi => {
            if (controller.signal.aborted) disposeApi()
            else dispose = disposeApi
        })

        return () => {
            controller.abort()
            if (dispose) dispose()
        }
    }, [uid, isAnonymous, enabled, disabledToolsKey])

    return null
}
