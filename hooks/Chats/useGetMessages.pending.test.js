import React from 'react'
import renderer, { act } from 'react-test-renderer'
import useGetMessages from './useGetMessages'
import { commentOutbox } from '../../utils/backends/Chats/commentOutbox'

let mockUserId = 'user'
let mockNext
jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: mockUserId } }),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../redux/actions', () => ({}))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: mockUserId } }) }))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({}))
jest.mock('../../utils/redux/loadingOperation', () => ({
    subscribeWithLoading: (_name, subscribe, next) => subscribe(next, jest.fn()),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    watchComments: (_project, _type, _object, _key, _limit, next) => {
        mockNext = next
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
const Harness = ({ projectId = 'project', objectId = 'object', objectType = 'tasks' }) => {
    messages = useGetMessages(false, false, projectId, objectId, objectType)
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
