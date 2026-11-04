import { openEmbeddedAppInNewTab, resolveReportedLocation } from './embeddedAppLocation'
import { buildEmbeddedToolWindowUrl, TEAM_ORIGIN } from '../../../../utils/embeddedToolWindowUrl'

export { TEAM_ORIGIN }
export const HANDOFF_TIMEOUT_MS = 30_000
const FRAME_PARAM = 'alldoneHandoff'
const CHANNEL_PREFIX = 'alldone-tool-handoff:'
export const createHandoffChannel = id => new BroadcastChannel(CHANNEL_PREFIX + id)

export const buildHandoffFrameUrl = (url, id) => {
    const target = new URL(url)
    target.searchParams.set(FRAME_PARAM, id)
    return target.href
}

// Open synchronously on the click. The destination only receives the checkpoint after it has
// signed in as the source user, and the original frame stays open until the destination restores it.
export const openToolHandoff = ({ url, title, userId, capture, onComplete }) => {
    if (!capture || !userId || typeof BroadcastChannel !== 'function' || !window.crypto?.randomUUID) {
        return 'unsupported'
    }

    const id = window.crypto.randomUUID()
    const destination = buildEmbeddedToolWindowUrl(url, id)
    if (!destination) return 'unsupported'
    let channel
    try {
        channel = createHandoffChannel(id)
    } catch (error) {
        return 'unsupported'
    }

    if (!openEmbeddedAppInNewTab(destination)) {
        channel.close()
        return 'blocked'
    }

    const finish = success => {
        clearTimeout(timeout)
        channel.close()
        onComplete(success)
    }
    const timeout = setTimeout(() => finish(false), HANDOFF_TIMEOUT_MS)
    const checkpoint = Promise.resolve()
        .then(() => capture(id))
        .then(result => {
            const location = resolveReportedLocation(result?.url, url)
            if (!location || result?.captured !== true) return null
            return { url: location, title }
        })
        .catch(() => null)

    channel.onmessage = async ({ data }) => {
        if (data?.userId !== userId) return
        if (data.type === 'ready') {
            const payload = await checkpoint
            try {
                channel.postMessage(payload ? { type: 'checkpoint', payload } : { type: 'failed' })
            } catch (error) {
                // The receiver may have timed out while the source was capturing.
            }
        } else if (data.type === 'restored' || data.type === 'failed') {
            finish(data.type === 'restored')
        }
    }

    return 'pending'
}
