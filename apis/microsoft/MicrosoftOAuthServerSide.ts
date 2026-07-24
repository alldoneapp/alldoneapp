import { runHttpsCallableFunction } from '../../utils/backends/firestore'

export interface MicrosoftAuthStatus {
    hasCredentials: boolean
    email?: string | null
    scopes?: string[]
    hasModifyScope?: boolean
    provider?: 'microsoft'
}

export interface RevokeResult {
    success: boolean
    message: string
}

export type MicrosoftService = 'calendar' | 'email'

export async function startMicrosoftServerSideAuth(
    projectId: string,
    service: MicrosoftService,
    returnUrl?: string,
    connectionId?: string
): Promise<void> {
    const result = await runHttpsCallableFunction('microsoftOAuthInitiate', {
        projectId,
        service,
        returnUrl,
        connectionId,
    })
    const { authUrl } = result

    if (returnUrl) {
        window.location.href = authUrl
        return new Promise(() => {})
    }

    const width = 600
    const height = 700
    const left = window.screen.width / 2 - width / 2
    const top = window.screen.height / 2 - height / 2
    const popup = window.open(authUrl, 'Microsoft OAuth', `width=${width},height=${height},left=${left},top=${top}`)

    if (!popup) throw new Error('Failed to open OAuth popup. Please allow popups for this site.')

    return new Promise((resolve, reject) => {
        let timeout: NodeJS.Timeout

        const messageHandler = (event: MessageEvent) => {
            if (event.data && typeof event.data === 'object') {
                if (event.data.type === 'oauth_success') {
                    window.removeEventListener('message', messageHandler)
                    clearTimeout(timeout)
                    resolve()
                } else if (event.data.type === 'oauth_error') {
                    window.removeEventListener('message', messageHandler)
                    clearTimeout(timeout)
                    reject(new Error(event.data.error || 'OAuth authentication failed'))
                }
            }
        }

        window.addEventListener('message', messageHandler)

        const checkPopupClosed = setInterval(() => {
            let isClosed = false
            try {
                isClosed = popup.closed
            } catch (e) {
                return
            }

            if (isClosed) {
                clearInterval(checkPopupClosed)
                window.removeEventListener('message', messageHandler)
                clearTimeout(timeout)
                hasMicrosoftServerSideAuth(projectId, service)
                    .then(status => {
                        if (status.hasCredentials) resolve()
                        else reject(new Error('OAuth flow was cancelled'))
                    })
                    .catch(reject)
            }
        }, 500)

        timeout = setTimeout(() => {
            window.removeEventListener('message', messageHandler)
            clearInterval(checkPopupClosed)
            if (!popup.closed) popup.close()
            reject(new Error('OAuth authentication timed out'))
        }, 5 * 60 * 1000)
    })
}

export async function hasMicrosoftServerSideAuth(
    projectId: string,
    service: MicrosoftService
): Promise<MicrosoftAuthStatus> {
    try {
        const result = await runHttpsCallableFunction('microsoftOAuthCheckCredentials', { projectId, service })
        return {
            hasCredentials: result.hasCredentials,
            email: result.email || null,
            scopes: result.scopes || [],
            hasModifyScope: result.hasModifyScope,
            provider: result.provider || 'microsoft',
        }
    } catch (error) {
        console.error('Error checking Microsoft credentials:', error)
        return { hasCredentials: false }
    }
}

export async function revokeMicrosoftServerSideAuth(
    projectId: string,
    service: MicrosoftService
): Promise<RevokeResult> {
    return runHttpsCallableFunction('microsoftOAuthRevoke', { projectId, service })
}
