/**
 * Server-Side Google OAuth Helper
 *
 * This module provides server-side OAuth authentication for Google Calendar and Gmail
 * that persists across devices and browser sessions.
 *
 * Usage:
 * - Use startServerSideAuth() to initiate OAuth flow
 * - Use hasServerSideAuth() to check if user has authenticated
 * - Use getServerSideToken() to get a fresh access token for API calls
 * - Use revokeServerSideAuth() to disconnect
 */

import { runHttpsCallableFunction } from '../../utils/backends/firestore'

export interface ServerSideAuthStatus {
    hasCredentials: boolean
    email?: string
}

export interface OAuthInitiateResult {
    authUrl: string
}

export interface TokenResult {
    accessToken: string
}

export interface RevokeResult {
    success: boolean
    message: string
}

/**
 * Initiate server-side OAuth flow for Google Calendar and Gmail
 * Opens a popup window for Google authentication
 *
 * @param projectId - The project ID to connect the calendar to
 * @returns Promise that resolves when OAuth is complete
 */
export async function startServerSideAuth(projectId: string): Promise<void> {
    try {
        const result = await runHttpsCallableFunction('googleOAuthInitiate', { projectId })
        const { authUrl } = result

        // Open OAuth URL in a popup window
        const width = 600
        const height = 700
        const left = window.screen.width / 2 - width / 2
        const top = window.screen.height / 2 - height / 2

        const popup = window.open(authUrl, 'Google OAuth', `width=${width},height=${height},left=${left},top=${top}`)

        if (!popup) {
            throw new Error('Failed to open OAuth popup. Please allow popups for this site.')
        }

        // Wait for OAuth callback to complete via postMessage
        return new Promise((resolve, reject) => {
            let timeout: NodeJS.Timeout

            // Listen for postMessage from the OAuth callback popup
            const messageHandler = (event: MessageEvent) => {
                // For security, verify the message structure (we allow * origin since callback page is controlled by us)
                if (event.data && typeof event.data === 'object') {
                    if (event.data.type === 'oauth_success') {
                        // Success! Clean up and resolve
                        window.removeEventListener('message', messageHandler)
                        clearTimeout(timeout)
                        resolve()
                    } else if (event.data.type === 'oauth_error') {
                        // OAuth failed
                        window.removeEventListener('message', messageHandler)
                        clearTimeout(timeout)
                        const errorMessage = event.data.error || 'OAuth authentication failed'
                        reject(new Error(errorMessage))
                    }
                }
            }

            window.addEventListener('message', messageHandler)

            // Fallback: check if popup was closed manually
            const checkPopupClosed = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkPopupClosed)
                    window.removeEventListener('message', messageHandler)
                    clearTimeout(timeout)

                    // Verify if auth succeeded by checking credentials
                    hasServerSideAuth()
                        .then(status => {
                            if (status.hasCredentials) {
                                resolve()
                            } else {
                                reject(new Error('OAuth flow was cancelled'))
                            }
                        })
                        .catch(reject)
                }
            }, 500)

            // Timeout after 5 minutes
            timeout = setTimeout(() => {
                window.removeEventListener('message', messageHandler)
                clearInterval(checkPopupClosed)
                if (!popup.closed) {
                    popup.close()
                }
                reject(new Error('OAuth authentication timed out'))
            }, 5 * 60 * 1000)
        })
    } catch (error) {
        console.error('Error initiating OAuth:', error)
        throw new Error(`Failed to start OAuth: ${error.message}`)
    }
}

/**
 * Check if user has valid server-side Google OAuth credentials
 *
 * @returns Promise with authentication status
 */
export async function hasServerSideAuth(): Promise<ServerSideAuthStatus> {
    try {
        const result = await runHttpsCallableFunction('googleOAuthCheckCredentials', {})
        return { hasCredentials: result.hasCredentials }
    } catch (error) {
        console.error('Error checking credentials:', error)
        return { hasCredentials: false }
    }
}

/**
 * Get a fresh access token for Google API calls
 * Automatically refreshes the token if needed
 *
 * @returns Promise with access token
 * @throws Error if user is not authenticated
 */
export async function getServerSideToken(): Promise<string> {
    try {
        const result = await runHttpsCallableFunction('googleOAuthGetToken', {})
        return result.accessToken
    } catch (error) {
        console.error('Error getting access token:', error)
        throw new Error(`Failed to get access token: ${error.message}`)
    }
}

/**
 * Revoke server-side Google OAuth access
 * Disconnects Google account and removes stored tokens
 *
 * @param projectId - Optional project ID to disconnect from (if null, disconnects all)
 * @returns Promise with revoke result
 */
export async function revokeServerSideAuth(projectId?: string): Promise<RevokeResult> {
    try {
        const result = await runHttpsCallableFunction('googleOAuthRevoke', { projectId })
        return result
    } catch (error) {
        console.error('Error revoking access:', error)
        throw new Error(`Failed to revoke access: ${error.message}`)
    }
}

/**
 * Set a server-side token in the GoogleApi for immediate use
 * This allows using the existing GoogleApi methods with server-side auth
 *
 * @param googleApi - The GoogleApi instance
 * @returns Promise that resolves when token is set
 */
export async function setServerTokenInGoogleApi(googleApi: any): Promise<void> {
    try {
        const accessToken = await getServerSideToken()

        // Set the token in gapi client if available
        if (googleApi.gapi?.client) {
            googleApi.gapi.client.setToken({
                access_token: accessToken,
                // Add the scopes so checkAccessGranted works
                scope:
                    'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.labels',
            })

            // Fetch user profile
            await googleApi.fetchUserProfile()
        }
    } catch (error) {
        console.error('Error setting server token in GoogleApi:', error)
        throw error
    }
}
