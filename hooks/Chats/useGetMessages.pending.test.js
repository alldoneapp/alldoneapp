import React from 'react'
import renderer, { act } from 'react-test-renderer'
import useGetMessages from './useGetMessages'
import { commentOutbox } from '../../utils/backends/Chats/commentOutbox'
import { createAnnaMessageCache } from '../../components/Anna/annaMessageCache'

let mockUserId = 'user'
let mockNext
let mockError
jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: mockUserId } }),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../redux/actions', () => ({}))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: mockUserId } }) }))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({}))
jest.mock('../../utils/redux/loadingOperation', () => ({
    subscribeWithLoading: (_name, subscribe, next, { onError } = {}) => subscribe(next, onError || jest.fn()),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    watchComments: (_project, _type, _object, _key, _limit, next, options) => {
        mockNext = next
        mockError = options.onError
    },
}))
jest.mock('../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))

let tree, messages
const entry = (id = 'request', values = {}) => ({
    id,
    userId: 'user',
    projectId: 'project',
    objectId: 'object',
    objectType: 'tasks',
    comment: '# Heading\n**Bold** and a link https://example.com',
    commentType: 'stayward',
    created: 1000,
    ...values,
})
const Harness = ({ projectId = 'project', objectId = 'object', objectType = 'tasks', cache }) => {
    messages = useGetMessages(false, false, projectId, objectId, objectType, 50, cache)
    return null
}
const mount = props =>
    act(() => {
        tree = renderer.create(<Harness {...props} />)
    })
beforeEach(() => {
    localStorage.clear()
    mockUserId = 'user'
    commentOutbox.configure({ activeUser: () => mockUserId, canSend: () => false, send: jest.fn() })
})
afterEach(() => act(() => tree?.unmount()))

it.each(['topics', 'tasks', 'projects', 'notes', 'goals', 'skills', 'contacts', 'assistants'])(
    'immediately exposes the final message shape for %s, even before the first snapshot',
    objectType => {
        mount({ objectType })
        act(() => commentOutbox.enqueue(entry('request', { objectType })))
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
            id: 'request',
            creatorId: 'user',
            commentText: entry().comment,
            created: 1000,
            lastChangeDate: 1000,
            fromAssistant: false,
            pendingSend: { status: 'pending' },
        })
        expect(messages.loaded).toBe(false)
    }
)

it('retains the same ID and content when delivery is acknowledged before the snapshot', async () => {
    mount()
    act(() => mockNext([]))
    let queued
    act(() => {
        queued = commentOutbox.enqueue(entry())
    })
    commentOutbox.configure({ activeUser: () => 'user', canSend: () => true, send: async () => {} })
    await act(async () => commentOutbox.flushOne(queued))
    expect(commentOutbox.list('user')).toHaveLength(0)
    expect(messages).toHaveLength(1)
    expect(messages[0].pendingSend).toBeUndefined()
    expect(messages[0].commentText).toBe(entry().comment)
    act(() => mockNext([{ id: 'request', creatorId: 'user', created: 1000, commentText: entry().comment }]))
    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe('request')
    // Once handed over, deleting a saved document must not resurrect the echo.
    act(() => mockNext([]))
    expect(messages).toHaveLength(0)
})

it('deduplicates an early Firestore echo while preserving failure and retry with the same ID', async () => {
    mount()
    let queued
    act(() => {
        queued = commentOutbox.enqueue(entry())
    })
    act(() => mockNext([{ id: 'request', creatorId: 'user', created: 1000, commentText: entry().comment }]))
    expect(messages).toHaveLength(1)
    const send = jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('Denied'), { code: 'permission-denied' }))
        .mockResolvedValueOnce(undefined)
    commentOutbox.configure({ activeUser: () => 'user', canSend: () => true, send })
    await act(async () => {
        await commentOutbox.flushOne(queued).catch(() => {})
    })
    expect(messages[0].pendingSend.status).toBe('failed')
    await act(async () => commentOutbox.retry('user', 'request'))
    expect(messages).toHaveLength(1)
    expect(messages[0].pendingSend).toBeUndefined()
    expect(send.mock.calls.map(([item]) => item.id)).toEqual(['request', 'request'])
})

it('restores queued messages and only includes this account and destination', () => {
    commentOutbox.enqueue(entry())
    commentOutbox.enqueue(entry('other-chat', { objectId: 'other' }))
    commentOutbox.enqueue(entry('other-project', { projectId: 'other' }))
    commentOutbox.enqueue(entry('other-type', { objectType: 'notes' }))
    commentOutbox.enqueue(entry('other-user', { userId: 'other-user' }))
    mount()
    act(() => mockNext([{ id: 'saved-in-original-chat', created: 500, commentText: 'Existing' }]))
    expect(messages.map(message => message.id)).toEqual(['saved-in-original-chat', 'request'])
    act(() => tree.update(<Harness objectId="other" />))
    expect(messages.map(message => message.id)).toEqual(['other-chat'])
    mockUserId = 'other-user'
    act(() => tree.update(<Harness />))
    expect(messages.map(message => message.id)).toEqual(['other-user'])
})

it('maps the users/contact alias and orders multiple queued and saved messages by creation', () => {
    commentOutbox.enqueue(entry('second', { objectType: 'users', created: 3000 }))
    commentOutbox.enqueue(entry('first', { objectType: 'contacts', created: 2000 }))
    mount({ objectType: 'contacts' })
    act(() => mockNext([{ id: 'old', created: 1000, lastChangeDate: 4000, commentText: 'Edited' }]))
    expect(messages.map(message => message.id)).toEqual(['old', 'first', 'second'])
})

const annaScope = {
    userId: 'user',
    projectId: 'project',
    objectId: 'AnnaChat20261012user',
    chatType: 'topics',
    limit: 50,
}
const annaProps = cache => ({ objectType: 'topics', objectId: annaScope.objectId, cache })
const savedMessages = [{ id: 'saved', creatorId: 'user', created: 1000, commentText: 'Previously loaded answer' }]

it('paints restored Anna messages before any snapshot and keeps them through an empty offline cache result', () => {
    const previousSession = createAnnaMessageCache()
    previousSession.write(annaScope, savedMessages)
    previousSession.flush()
    const cache = createAnnaMessageCache()
    mount(annaProps(cache))
    expect([...messages]).toEqual(savedMessages)
    expect(messages.loaded).toBe(true)
    act(() => mockNext([], { fromCache: true, hasPendingWrites: false }))
    expect([...messages]).toEqual(savedMessages)
    act(() => mockNext([{ ...savedMessages[0], commentText: 'Updated on server' }], { fromCache: false }))
    expect(messages[0].commentText).toBe('Updated on server')
    act(() => mockNext([], { fromCache: false }))
    expect(messages).toHaveLength(0)
    cache.flush()
    expect(createAnnaMessageCache().read(annaScope)).toEqual([])
})

it('retains Anna messages on transient failures but clears them when access is revoked', () => {
    const cache = createAnnaMessageCache()
    cache.write(annaScope, savedMessages)
    mount(annaProps(cache))
    act(() => mockError({ code: 'unavailable' }))
    expect([...messages]).toEqual(savedMessages)
    act(() => mockError({ code: 'permission-denied' }))
    expect(messages).toHaveLength(0)
    expect(cache.read(annaScope)).toBeNull()
    expect(createAnnaMessageCache().read(annaScope)).toBeNull()
})

it('never shows the previous account or thread snapshot when switching destinations', () => {
    const cache = createAnnaMessageCache()
    cache.write(annaScope, savedMessages)
    mount(annaProps(cache))
    expect(messages).toHaveLength(1)
    act(() => tree.update(<Harness {...annaProps(cache)} objectId="AnnaChat20261011user" />))
    expect(messages).toHaveLength(0)
    mockUserId = 'different'
    act(() => tree.update(<Harness {...annaProps(cache)} />))
    expect(messages).toHaveLength(0)
})
