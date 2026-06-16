import { beginMcpOAuth, completeMcpOAuth } from '../backends/firestore'

const POLL_INTERVAL_MS = 2000
const TIMEOUT_MS = 5 * 60 * 1000

/**
 * Run the interactive MCP OAuth flow from the browser:
 *   1. ask the backend to discover + register + build the authorization URL,
 *   2. open it in a popup,
 *   3. wait for the callback page to postMessage completion (and also poll as a
 *      fallback, e.g. if popups block window.opener),
 *   4. fetch the resulting tokens.
 *
 * Pass `clientId` (+ optional `clientSecret`, `scope`) to use a pre-registered
 * OAuth client instead of Dynamic Client Registration.
 *
 * Returns the secret bundle to hand to connectAssistantMcpServer:
 *   { accessToken, refreshToken, expiresAt, oauthContext }
 */
export async function startMcpOAuthFlow({ serverUrl, clientId, clientSecret, scope }) {
    const { authorizationUrl, state } = await beginMcpOAuth({ serverUrl, clientId, clientSecret, scope })
    if (!authorizationUrl || !state) {
        throw new Error('Could not start the OAuth flow.')
    }

    const popup =
        typeof window !== 'undefined' && window.open
            ? window.open(authorizationUrl, 'mcp_oauth', 'width=520,height=720')
            : null
    if (!popup) {
        // Popup blocked — fall back to a full redirect is not desirable here, so
        // surface a clear error asking the user to allow popups.
        throw new Error('Please allow popups to authorize with OAuth, then try again.')
    }

    return new Promise((resolve, reject) => {
        let finished = false
        const deadline = Date.now() + TIMEOUT_MS

        const cleanup = () => {
            finished = true
            window.removeEventListener('message', onMessage)
            clearInterval(pollTimer)
        }

        const finish = async () => {
            try {
                const result = await completeMcpOAuth({ state })
                if (result && result.status === 'complete') {
                    cleanup()
                    resolve({
                        accessToken: result.accessToken,
                        refreshToken: result.refreshToken || null,
                        expiresAt: result.expiresAt || null,
                        oauthContext: result.oauthContext || null,
                    })
                    return true
                }
            } catch (e) {
                cleanup()
                reject(e)
                return true
            }
            return false
        }

        const onMessage = event => {
            const data = event && event.data
            if (!data || data.type !== 'mcp_oauth_complete' || data.state !== state) return
            if (!data.ok) {
                cleanup()
                reject(new Error('Authorization was denied or failed.'))
                return
            }
            finish()
        }

        // Poll as a fallback for the postMessage (handles popup/opener edge cases).
        const pollTimer = setInterval(async () => {
            if (finished) return
            if (Date.now() > deadline) {
                cleanup()
                reject(new Error('OAuth authorization timed out.'))
                return
            }
            await finish()
        }, POLL_INTERVAL_MS)

        window.addEventListener('message', onMessage)
    })
}
