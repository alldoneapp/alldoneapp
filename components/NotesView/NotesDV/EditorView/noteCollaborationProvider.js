import { WebsocketProvider } from 'y-websocket'

// security audit 2026-11 (notes-collab:y-websocket-room-by-noteId-without-credential): the
// collaboration room is the bare note id, and the client used to send no credential, so the
// collaboration server could not tell who was connecting. Every connection now carries the signed-in
// user's Firebase ID token and the note's project as query parameters:
//
//     <NOTES_COLLABORATION_SERVER>/<noteId>?auth=<Firebase ID token>&projectId=<projectId>
//
// The room name stays the bare note id. The server (alldone-notes-collab-server, another repository)
// asks functions/Notes/notesCollabAccess.js whether the user may read and write the note, and refuses
// the connection (or drops its edits, for read-only access) once it runs with NOTES_AUTH_MODE=enforce.
//
// An ID token lives one hour, and y-websocket 1.3.17 reconnects on its own, synchronously, with the
// URL it built in its constructor (it has no `params` property to update). So the token is read when
// each socket is opened, through the WebSocket class the provider is given, and a fresh one is
// fetched in the background every time: `getIdToken()` answers from the SDK's cache and renews a token
// close to expiry, so the next reconnect carries a current one.

export const NOTE_COLLABORATION_TOKEN_WAIT_MS = 5000
// The collaboration server re-checks a connection's token periodically and closes it once the token
// has expired; the provider then reconnects with whatever token it holds. A socket can stay open far
// longer than the one hour a token lives, so the token is also refreshed on this interval: by the
// time the server closes the connection, the provider already holds the token the SDK renewed.
export const NOTE_COLLABORATION_TOKEN_REFRESH_MS = 10 * 60 * 1000

const stripTrailingSlashes = url => {
    let result = String(url || '')
    while (result.endsWith('/')) result = result.slice(0, -1)
    return result
}

export const buildNoteCollaborationParams = (token, projectId) => {
    const params = {}
    if (token) params.auth = token
    if (projectId) params.projectId = projectId
    return params
}

export const buildNoteCollaborationUrl = (serverUrl, noteId, params) => {
    const query = Object.keys(params)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&')
    return `${stripTrailingSlashes(serverUrl)}/${noteId}${query ? `?${query}` : ''}`
}

const defaultGetIdToken = forceRefresh => {
    // Required lazily so this module (and the editor) can be loaded without the Firebase client.
    const firebase = require('firebase/compat/app').default
    const user = firebase.auth().currentUser
    return user ? user.getIdToken(forceRefresh) : Promise.resolve(null)
}

/**
 * A y-websocket provider for one note that authenticates every (re)connection. Returns the provider
 * synchronously, like `new WebsocketProvider(...)`; it connects once the first token is known (or
 * after NOTE_COLLABORATION_TOKEN_WAIT_MS, so a slow token never keeps a note from syncing).
 */
export function createNoteCollaborationProvider({
    serverUrl,
    noteId,
    projectId,
    doc,
    getIdToken = defaultGetIdToken,
    WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : undefined,
    ProviderImpl = WebsocketProvider,
    tokenWaitMs = NOTE_COLLABORATION_TOKEN_WAIT_MS,
    tokenRefreshMs = NOTE_COLLABORATION_TOKEN_REFRESH_MS,
    providerOptions = {},
}) {
    let token = null
    let destroyed = false
    let provider = null

    const currentParams = () => buildNoteCollaborationParams(token, projectId)
    const currentUrl = () => buildNoteCollaborationUrl(serverUrl, noteId, currentParams())

    const refreshToken = async () => {
        try {
            const next = await getIdToken(false)
            if (next) token = next
        } catch (error) {
            // Offline or signed out: keep the last token. The server refuses a stale one, and
            // y-websocket simply tries again.
        }
        if (provider) provider.url = currentUrl()
        return token
    }

    class AuthenticatedNoteWebSocket extends WebSocketImpl {
        constructor(_url, protocols) {
            super(currentUrl(), protocols)
            refreshToken()
        }
    }

    provider = new ProviderImpl(serverUrl, noteId, doc, {
        ...providerOptions,
        connect: false,
        params: currentParams(),
        WebSocketPolyfill: AuthenticatedNoteWebSocket,
    })

    const refreshTimer = setInterval(refreshToken, tokenRefreshMs)

    const destroy = provider.destroy.bind(provider)
    provider.destroy = (...args) => {
        destroyed = true
        clearInterval(refreshTimer)
        return destroy(...args)
    }

    let waitTimer = null
    Promise.race([
        refreshToken(),
        new Promise(resolve => {
            waitTimer = setTimeout(resolve, tokenWaitMs)
        }),
    ]).then(() => {
        clearTimeout(waitTimer)
        if (!destroyed && providerOptions.connect !== false) provider.connect()
    })

    return provider
}
