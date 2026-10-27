import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import firebase from 'firebase/compat/app'

import { shouldUseFirebaseEmulators } from '../../utils/firebaseEmulators'
import {
    AGENT_API_STATES,
    createMcpSessionClient,
    getMcpServerEndpoint,
    installBrowserAgentApi,
    installWindowApiStub,
} from '../../utils/browserAgent/browserAgentApi'
import { ensureWebMcpOriginTrialToken } from '../../utils/browserAgent/webMcpOriginTrial'

/**
 * Exposes the signed-in user's Alldone tools to browser agents (AT-2871): WebMCP when the browser
 * has it, `window.alldone` always. Renders nothing.
 *
 * Mounted for the whole app, not only the logged-in tree (AT-2890): while Alldone is loading or
 * nobody is signed in, `window.alldone` is a stub with no tools that tells an agent to wait
 * (`whenReady()`) or to ask the user to sign in, so an agent that arrives early still finds it.
 * `sessionReady` is true once the signed-in app has processed its initial URL — the moment the
 * logged-in tree used to mount this component.
 *
 * On by default. Settings → MCP → "Browser agents" switches it off (`browserAgentToolsEnabled`), and
 * the MCP master switch switches it off too; a signed-in user who did so gets no `window.alldone` at
 * all, not even the stub. The MCP server enforces both as well, so this gate only decides whether the
 * page advertises anything.
 */
export const resolveBrowserAgentPageState = ({ loggedIn, uid, isAnonymous, enabled, sessionReady }) => {
    if (isAnonymous || loggedIn === false) return AGENT_API_STATES.SIGNED_OUT
    // Still booting, or signed in while the user document has not arrived yet.
    if (loggedIn !== true || !uid) return AGENT_API_STATES.LOADING
    if (!enabled) return null
    return sessionReady ? AGENT_API_STATES.READY : AGENT_API_STATES.LOADING
}

export default function BrowserAgentApiBridge({ sessionReady = true }) {
    const loggedIn = useSelector(state => state.loggedIn)
    const uid = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => !!state.loggedUser.isAnonymous)
    const enabled = useSelector(
        state => state.loggedUser.mcpEnabled !== false && state.loggedUser.browserAgentToolsEnabled !== false
    )
    // Re-register when the user changes which tools MCP clients may use.
    const disabledToolsKey = useSelector(state =>
        Array.isArray(state.loggedUser.mcpDisabledTools) ? state.loggedUser.mcpDisabledTools.join(',') : ''
    )

    const pageState = resolveBrowserAgentPageState({ loggedIn, uid, isAnonymous, enabled, sessionReady })

    useEffect(() => {
        if (typeof window === 'undefined' || !pageState) return undefined
        if (pageState !== AGENT_API_STATES.READY) return installWindowApiStub(window, { state: pageState })

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
    }, [pageState, uid, disabledToolsKey])

    return null
}
