import {
    beginIosShareCredentialProvisioning,
    getIosShareExtensionPlugin,
    isCurrentIosShareCredentialProvisioning,
} from './CapacitorShell'
import { mintIosShareExtensionToken } from './backends/firestore'

let provisioningQueue = Promise.resolve()

// security audit 2026-11 (NV-33): the Share Extension sends its token and everything the user shares
// to the stored endpoint. A stored endpoint that is not the Alldone `iosShareTask` function (planted
// through the native bridge, say) is never kept just because the user id matches: it is replaced
// by a freshly minted credential. Keep in step with IosShareEndpointPolicy in the iOS shell.
const TRUSTED_SHARE_ENDPOINT_HOSTS = new Set([
    'europe-west1-alldonealeph.cloudfunctions.net',
    'europe-west1-alldonestaging.cloudfunctions.net',
])

export function isTrustedIosShareEndpoint(value, { allowEmulator = typeof __DEV__ !== 'undefined' && !!__DEV__ } = {}) {
    let url
    try {
        url = new URL(String(value || ''))
    } catch (_) {
        return false
    }
    if (url.username || url.password || url.search || url.hash) return false
    if (url.protocol === 'https:' && !url.port && TRUSTED_SHARE_ENDPOINT_HOSTS.has(url.hostname)) {
        return url.pathname === '/iosShareTask'
    }
    return (
        allowEmulator &&
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        url.port === '5001' &&
        url.pathname.endsWith('/europe-west1/iosShareTask')
    )
}

async function provisionIosShareExtensionCredential({ userId, plugin, generation, deps }) {
    const isCurrentProvisioning = deps.isCurrentProvisioning || isCurrentIosShareCredentialProvisioning
    if (!isCurrentProvisioning(generation)) return false

    const current = await plugin.getCredential()
    if (!isCurrentProvisioning(generation)) return false
    if (current?.userId === userId && current?.token && isTrustedIosShareEndpoint(current?.endpointUrl)) return true

    const installationId = current?.installationId
    if (!installationId) throw new Error('The iOS share extension installation ID is unavailable')

    const mintToken = deps.mintToken || mintIosShareExtensionToken
    const credential = await mintToken(installationId)
    if (!credential?.token || !credential?.endpointUrl) {
        throw new Error('The iOS share extension credential was not returned')
    }
    if (!isTrustedIosShareEndpoint(credential.endpointUrl)) {
        throw new Error('The iOS share extension endpoint is not an Alldone endpoint')
    }
    if (!isCurrentProvisioning(generation)) return false

    await plugin.setCredential({
        installationId,
        userId,
        token: credential.token,
        endpointUrl: credential.endpointUrl,
    })
    return true
}

export function ensureIosShareExtensionCredential(userId, deps = {}) {
    if (!userId) return Promise.resolve(false)

    const plugin = deps.plugin || getIosShareExtensionPlugin()
    if (!plugin) return Promise.resolve(false)

    const generation = (deps.beginProvisioning || beginIosShareCredentialProvisioning)()
    const provision = () => provisionIosShareExtensionCredential({ userId, plugin, generation, deps })
    const result = provisioningQueue.then(provision, provision)
    // Serialize token rotations for this installation. The backend revokes the
    // previous token whenever it mints a new one, so parallel rotations could
    // otherwise leave the client holding the loser of that race.
    provisioningQueue = result.catch(() => false)
    return result
}
