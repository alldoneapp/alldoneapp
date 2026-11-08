import {
    beginIosShareCredentialProvisioning,
    getIosShareExtensionPlugin,
    isCurrentIosShareCredentialProvisioning,
} from './CapacitorShell'
import { mintIosShareExtensionToken } from './backends/firestore'

let provisioningQueue = Promise.resolve()

async function provisionIosShareExtensionCredential({ userId, plugin, generation, deps }) {
    const isCurrentProvisioning = deps.isCurrentProvisioning || isCurrentIosShareCredentialProvisioning
    if (!isCurrentProvisioning(generation)) return false

    const current = await plugin.getCredential()
    if (!isCurrentProvisioning(generation)) return false
    if (current?.userId === userId && current?.token && current?.endpointUrl) return true

    const installationId = current?.installationId
    if (!installationId) throw new Error('The iOS share extension installation ID is unavailable')

    const mintToken = deps.mintToken || mintIosShareExtensionToken
    const credential = await mintToken(installationId)
    if (!credential?.token || !credential?.endpointUrl) {
        throw new Error('The iOS share extension credential was not returned')
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
