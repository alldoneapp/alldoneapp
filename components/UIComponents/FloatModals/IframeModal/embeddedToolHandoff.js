import { openEmbeddedAppInNewTab, resolveReportedLocation } from './embeddedAppLocation'

export const TEAM_ORIGIN = 'https://alldone.team'
export const HANDOFF_TIMEOUT_MS = 30_000
const HOST_PARAM = 'toolHandoff'
const FRAME_PARAM = 'alldoneHandoff'
const CHANNEL_PREFIX = 'alldone-tool-handoff:'
const isHandoffId = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '')

export const readToolHandoffId = () => {
    const id = new URLSearchParams(window.location.search).get(HOST_PARAM)
    return isHandoffId(id) ? id : null
}

export const createHandoffChannel = id => new BroadcastChannel(CHANNEL_PREFIX + id)

export const buildHandoffFrameUrl = (url, id) => {
    const target = new URL(url)
    target.searchParams.set(FRAME_PARAM, id)
    return target.href
}

const hostUrl = id => {
    const url = new URL('/', window.location.origin)
    url.searchParams.set(HOST_PARAM, id)
    return url.href
}

// Open synchronously on the click. The destination only receives the checkpoint after it has
// signed in as the source user, and the original frame stays open until the destination restores it.
export const openToolHandoff = ({ url, title, userId, capture, onComplete }) => {
    if (
        !resolveReportedLocation(url, TEAM_ORIGIN) ||
        !capture ||
        !userId ||
        typeof BroadcastChannel !== 'function' ||
        !window.crypto?.randomUUID
    ) {
        return 'unsupported'
    }

    const id = window.crypto.randomUUID()
    let channel
    try {
        channel = createHandoffChannel(id)
    } catch (error) {
        return 'unsupported'
    }

    if (!openEmbeddedAppInNewTab(hostUrl(id))) {
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
