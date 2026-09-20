import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { createStore } from 'redux'
import { reduceLoadingData } from '../../redux/loadingData'
import { beginLoadingOperation, INITIAL_LOAD_TIMEOUT_MS } from '../../utils/redux/loadingOperation'
import useGetChats from './useGetChats'
import useGetStickyChats from './useGetStickyChats'
import useGetMessages from './useGetMessages'

let mockStore
let mockNext
let mockError
const mockUnsubscribe = jest.fn()
const mockSubscribe = (next, error) => {
    mockNext = next
    mockError = error
    return mockUnsubscribe
}
const mockQuery = {
    where: () => mockQuery,
    orderBy: () => mockQuery,
    limit: () => mockQuery,
    onSnapshot: (...args) => mockSubscribe(...args),
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user', isAnonymous: false } }),
    useDispatch: () => mockStore.dispatch,
}))
jest.mock('../../redux/store', () => ({ getState: () => mockStore.getState() }))
jest.mock('../../utils/redux/dispatchBatch', () => ({ batchDispatch: action => mockStore.dispatch(action) }))
jest.mock('../../utils/backends/firestore', () => ({
    getDb: () => ({ collection: () => mockQuery }),
    unwatch: () => mockUnsubscribe(),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    watchComments: (project, type, object, key, limit, next, options) => mockSubscribe(next, options.onError),
}))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: jest.fn() }))
jest.mock('../../components/HashtagFilters/UseSelectorHashtagFilters', () => () => [new Map(), []])
jest.mock('../../components/HashtagFilters/FilterHelpers/FilterChats', () => ({
    filterChats: chats => chats,
    filterStickyChats: chats => chats,
}))
jest.mock('../../utils/backends/Chats/chatAccessQuery', () => ({
    getChatAccessQueryArgs: () => ['readerIds', 'array-contains', 'user'],
}))
jest.mock('../../utils/InitialLoad/secondaryViewCache', () => ({
    buildSecondaryViewCacheKey: () => 'cache-key',
    getSecondaryViewCacheEntrySync: () => null,
    getSecondaryViewCacheEntry: () => Promise.resolve(null),
    setSecondaryViewCacheEntry: jest.fn(),
}))

const cases = [
    ['chats', () => useGetChats('project', 10, 0), { forEach: () => {} }],
    ['sticky chats', () => useGetStickyChats('project', 10, 0), { forEach: () => {} }],
    ['messages', () => useGetMessages(false, true, 'project', 'chat', 'topics'), []],
]

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockStore = createStore((state = { isLoadingData: 0 }, action) => reduceLoadingData(state, action))
})
afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
})

describe.each(cases)('%s loading lifecycle', (name, useHook, emptySnapshot) => {
    const renderHook = onRender => {
        function Harness() {
            onRender(useHook())
            return null
        }
        let tree
        act(() => {
            tree = renderer.create(<Harness />)
        })
        return tree
    }

    it('releases only its own load on failure and unmount', () => {
        const tree = renderHook(jest.fn())
        const finishOther = beginLoadingOperation('other')
        expect(mockStore.getState().isLoadingData).toBe(2)
        act(() => mockError({ code: 'permission-denied' }))
        expect(mockStore.getState().isLoadingData).toBe(1)
        act(() => tree.unmount())
        expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
        expect(mockStore.getState().isLoadingData).toBe(1)
        finishOther()
    })

    it('accepts data after the feedback timeout but ignores data after cancellation', () => {
        const onRender = jest.fn()
        const tree = renderHook(onRender)
        act(() => jest.advanceTimersByTime(INITIAL_LOAD_TIMEOUT_MS))
        expect(mockStore.getState().isLoadingData).toBe(0)
        expect(mockUnsubscribe).not.toHaveBeenCalled()

        const previousRenderCount = onRender.mock.calls.length
        act(() => mockNext(emptySnapshot))
        expect(onRender.mock.calls.length).toBeGreaterThan(previousRenderCount)
        act(() => tree.unmount())
        const finalRenderCount = onRender.mock.calls.length
        const finishOther = beginLoadingOperation('newer')
        act(() => mockNext(emptySnapshot))
        expect(onRender).toHaveBeenCalledTimes(finalRenderCount)
        expect(mockStore.getState().isLoadingData).toBe(1)
        finishOther()
    })
})
