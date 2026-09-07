/** @jest-environment jsdom */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import useLastCommentPreview, { LAST_COMMENT_LOAD_TIMEOUT_MS } from './useLastCommentPreview'
import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import {
    readDocumentDirectlyFromServer,
    readLatestCommentDirectlyFromServer,
} from '../../../../utils/backends/firestoreDirectRead'
import { isManualOfflineMode } from '../../../../utils/connectionHealth'
import { writeLastCommentCache, readLastCommentCache } from '../assistantLineCache'

jest.mock('../../../../utils/backends/Chats/chatsFirestore', () => ({ watchChat: jest.fn() }))
jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({ watchComments: jest.fn() }))
jest.mock('../../../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../../../../utils/backends/firestoreDirectRead', () => ({
    readDocumentDirectlyFromServer: jest.fn(),
    readLatestCommentDirectlyFromServer: jest.fn(),
}))
jest.mock('../../../../utils/connectionState', () => ({ isBrowserOffline: () => false }))
jest.mock('../../../../utils/connectionHealth', () => ({ isManualOfflineMode: jest.fn(() => false) }))

const context = { userId: 'user-1', projectId: 'project-1', objectType: 'topics', objectId: 'chat-1' }
const cached = { commentText: 'Cached comment', chat: { title: 'Topic', assistantId: 'assistant-1' } }
const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}
let latest, tree
function Probe({ context: scope = context, amount = 1 }) {
    latest = useLastCommentPreview(scope, amount)
    return null
}
const mount = async props => {
    await act(async () => {
        tree = renderer.create(<Probe {...props} />)
    })
}
const emitChat = (value = cached.chat, metadata = { fromCache: false }) =>
    act(() => watchChat.mock.calls.at(-1)[3](value, metadata))
const emitComments = (value = [{ id: 'comment-1', commentText: 'Live comment' }], metadata = { fromCache: false }) =>
    act(() => watchComments.mock.calls.at(-1)[5](value, metadata))

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    localStorage.clear()
    isManualOfflineMode.mockReturnValue(false)
    readDocumentDirectlyFromServer.mockImplementation(() => new Promise(() => {}))
    readLatestCommentDirectlyFromServer.mockImplementation(() => new Promise(() => {}))
})
afterEach(() => {
    act(() => tree?.unmount())
    jest.useRealTimers()
})

it('keeps a days-old preview during empty cache snapshots and refresh errors', async () => {
    writeLastCommentCache(context, cached)
    jest.advanceTimersByTime(3 * 86400000)
    await mount()
    expect(latest.commentText).toBe('Cached comment')
    act(() => jest.advanceTimersByTime(1000))
    emitChat(undefined, { fromCache: true })
    emitComments([], { fromCache: true })
    act(() => watchComments.mock.calls.at(-1)[6].onError({ code: 'unavailable' }))
    expect(latest).toMatchObject({ commentText: 'Cached comment', failed: false })
    expect(readLatestCommentDirectlyFromServer).not.toHaveBeenCalled()
})
it('renders an uncached preview through direct reads while listeners have not answered', async () => {
    readDocumentDirectlyFromServer.mockResolvedValue({ exists: true, data: cached.chat })
    readLatestCommentDirectlyFromServer.mockResolvedValue([{ id: 'c1', commentText: 'Direct preview' }])
    await mount()
    expect(latest).toMatchObject({ chat: cached.chat, commentText: 'Direct preview', failed: false })
    expect(readLastCommentCache(context).commentText).toBe('Direct preview')
    emitComments([{ id: 'c2', commentText: 'Live replacement' }])
    expect(latest.commentText).toBe('Live replacement')
})
it('bounds a stalled load, aborts it, and can recover on retry', async () => {
    await mount()
    act(() => jest.advanceTimersByTime(LAST_COMMENT_LOAD_TIMEOUT_MS))
    expect(latest.failed).toBe(true)
    expect(readLatestCommentDirectlyFromServer.mock.calls[0][1].signal.aborted).toBe(true)
    readDocumentDirectlyFromServer.mockResolvedValue({ exists: true, data: cached.chat })
    readLatestCommentDirectlyFromServer.mockResolvedValue([{ commentText: 'Retried preview' }])
    await act(async () => latest.retry())
    expect(latest).toMatchObject({ commentText: 'Retried preview', failed: false })
})
it('accepts a late listener success after the timeout', async () => {
    await mount()
    act(() => jest.advanceTimersByTime(LAST_COMMENT_LOAD_TIMEOUT_MS))
    emitChat()
    emitComments()
    expect(latest).toMatchObject({ commentText: 'Live comment', failed: false })
})
it('does not overwrite live data with an older direct response or a cache snapshot', async () => {
    const chat = deferred(),
        comments = deferred()
    readDocumentDirectlyFromServer.mockReturnValue(chat.promise)
    readLatestCommentDirectlyFromServer.mockReturnValue(comments.promise)
    await mount()
    emitChat()
    emitComments()
    await act(async () => {
        chat.resolve({ exists: true, data: { title: 'Old topic' } })
        comments.resolve([{ commentText: 'Old comment' }])
    })
    emitComments([{ commentText: 'Older cached comment' }], { fromCache: true })
    expect(latest).toMatchObject({ chat: cached.chat, commentText: 'Live comment' })
})
it('invalidates the preview after authoritative deletion or permission denial', async () => {
    writeLastCommentCache(context, cached)
    await mount()
    act(() => jest.advanceTimersByTime(1000))
    emitComments([])
    expect(latest.failed).toBe(true)
    expect(readLastCommentCache(context)).toBeNull()
    emitComments()
    expect(latest.failed).toBe(false)
    act(() => watchChat.mock.calls.at(-1)[4].onError({ code: 'permission-denied' }))
    emitComments()
    expect(latest).toMatchObject({ commentText: null, failed: true })
    expect(readLastCommentCache(context)).toBeNull()
})
it('does not send direct network reads in manual offline mode', async () => {
    isManualOfflineMode.mockReturnValue(true)
    await mount()
    expect(latest.failed).toBe(true)
    expect(readLatestCommentDirectlyFromServer).not.toHaveBeenCalled()
    emitChat(cached.chat, { fromCache: true })
    emitComments([{ commentText: 'Offline cache' }], { fromCache: true })
    expect(latest).toMatchObject({ commentText: 'Offline cache', failed: false })
})
it('ignores old callbacks and responses after an account or chat switch', async () => {
    const result = deferred()
    readLatestCommentDirectlyFromServer.mockReturnValueOnce(result.promise)
    await mount()
    const previous = watchComments.mock.calls[0][5]
    await act(async () => tree.update(<Probe context={{ ...context, userId: 'user-2', objectId: 'chat-2' }} />))
    await act(async () => {
        previous([{ commentText: 'Other account' }])
        result.resolve([{ commentText: 'Other chat' }])
    })
    expect(latest.commentText).toBeUndefined()
    expect(readLastCommentCache({ ...context, userId: 'user-2', objectId: 'chat-2' })).toBeNull()
})
