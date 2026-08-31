let configuredAccountsId = null
let configuredCallback = null

/** Google Identity Services expects one initialization per loaded client instance. */
export function initializeGoogleIdentity({ accountsId, clientId, callback }) {
    if (!accountsId || typeof accountsId.initialize !== 'function') {
        throw new Error('Google Identity Services is not loaded')
    }
    if (configuredAccountsId === accountsId && configuredCallback === callback) return false

    accountsId.initialize({
        client_id: clientId,
        callback,
        itp_support: true,
    })
    configuredAccountsId = accountsId
    configuredCallback = callback
    return true
}
