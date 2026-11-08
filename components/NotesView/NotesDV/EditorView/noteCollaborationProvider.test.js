/**
 * @jest-environment jsdom
 *
 * security audit 2026-11 (notes-collab:y-websocket-room-by-noteId-without-credential): every
 * connection to a note's collaboration room carries the signed-in user's Firebase ID token and the
 * note's project, `?auth=<token>&projectId=<projectId>`, and a reconnect carries a fresh token. The
 * room name stays the bare note id. Drives the REAL y-websocket provider; only the socket is fake.
 */
import * as Y from 'yjs'
import {
    buildNoteCollaborationUrl,
    createNoteCollaborationProvider,
    NOTE_COLLABORATION_TOKEN_WAIT_MS,
} from './noteCollaborationProvider'

const SERVER = 'wss://collab.example.test/'
const sockets = []

class FakeWebSocket {
    constructor(url) {
        this.url = url
        this.readyState = 0
        sockets.push(this)
    }
    send() {}
    close() {
        this.readyState = 3
        this.onclose?.()
    }
}

const waitFor = async (predicate, timeoutMs = 3000) => {
    const started = Date.now()
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error('timed out')
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

const params = url => Object.fromEntries(new URL(url).searchParams.entries())

describe('the notes collaboration provider', () => {
    let providers

    beforeEach(() => {
        sockets.length = 0
        providers = []
    })

    afterEach(() => {
        providers.forEach(provider => provider.destroy())
    })

    const create = options => {
        const provider = createNoteCollaborationProvider({
            serverUrl: SERVER,
            noteId: 'note1',
            projectId: 'project1',
            doc: new Y.Doc(),
            WebSocketImpl: FakeWebSocket,
            ...options,
        })
        providers.push(provider)
        return provider
    }

    it('connects to the bare note id room with the ID token and the project', async () => {
        const getIdToken = jest.fn().mockResolvedValue('token-1')
        create({ getIdToken })

        await waitFor(() => sockets.length === 1)

        const url = new URL(sockets[0].url)
        expect(url.origin + url.pathname).toBe('wss://collab.example.test/note1')
        expect(params(sockets[0].url)).toEqual({ auth: 'token-1', projectId: 'project1' })
    })

    it('opens no connection before the token is known', async () => {
        let resolveToken
        create({ getIdToken: () => new Promise(resolve => (resolveToken = resolve)) })

        await new Promise(resolve => setTimeout(resolve, 50))
        expect(sockets).toHaveLength(0)

        resolveToken('token-1')
        await waitFor(() => sockets.length === 1)
        expect(params(sockets[0].url).auth).toBe('token-1')
    })

    it('reconnects with a fresh token', async () => {
        const getIdToken = jest.fn().mockResolvedValueOnce('token-1').mockResolvedValue('token-2')
        create({ getIdToken })
        await waitFor(() => sockets.length === 1)
        await new Promise(resolve => setTimeout(resolve, 20))

        sockets[0].close()
        await waitFor(() => sockets.length === 2)

        expect(params(sockets[1].url)).toEqual({ auth: 'token-2', projectId: 'project1' })
    })

    it('never connects once destroyed before the token arrived', async () => {
        let resolveToken
        const provider = create({ getIdToken: () => new Promise(resolve => (resolveToken = resolve)) })
        provider.destroy()
        providers = []

        resolveToken('token-1')
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(sockets).toHaveLength(0)
    })

    it('still connects, without a token, when none can be had', async () => {
        create({ getIdToken: () => Promise.reject(new Error('offline')), tokenWaitMs: 10 })

        await waitFor(() => sockets.length === 1)
        expect(params(sockets[0].url)).toEqual({ projectId: 'project1' })
    })

    it('does not wait for a slow token longer than the bound', () => {
        expect(NOTE_COLLABORATION_TOKEN_WAIT_MS).toBeLessThanOrEqual(10000)
    })

    it('builds the URL the way y-websocket does', () => {
        expect(buildNoteCollaborationUrl('wss://x//', 'n', { auth: 'a b', projectId: 'p' })).toBe(
            'wss://x/n?auth=a%20b&projectId=p'
        )
        expect(buildNoteCollaborationUrl('wss://x', 'n', {})).toBe('wss://x/n')
    })
})
