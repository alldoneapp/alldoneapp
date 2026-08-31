/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useGetChats, { getChatsViewCacheKey } from './useGetChats'
import { ALL_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import { getDb } from '../../utils/backends/firestore'
import {
    getSecondaryViewCacheEntrySync,
    resetSecondaryViewCacheForTests,
    SECONDARY_VIEW_CHATS,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ loggedUser: { uid: 'user-1', isAnonymous: false } }),
}))
jest.mock('../../redux/actions', () => ({
    startLoadingData: () => ({ type: 'start-loading' }),
    stopLoadingData: () => ({ type: 'stop-loading' }),
}))
jest.mock('../../components/HashtagFilters/UseSelectorHashtagFilters', () => () => [new Map(), []])
jest.mock('../../components/HashtagFilters/FilterHelpers/FilterChats', () => ({
    filterChats: chats => chats,
}))
jest.mock('../../utils/backends/firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../utils/backends/Chats/chatAccessQuery', () => ({
    getChatAccessQueryArgs: () => ['readerIds', 'array-contains', 'user-1'],
}))

const buildDocs = chats => ({
    forEach: callback => chats.forEach(chat => callback({ id: chat.id, data: () => chat })),
})

function HookHarness({ onRender }) {
    onRender(useGetChats('project-1', 10, ALL_TAB))
    return null
}

describe('useGetChats cached-first refresh', () => {
    let deliverSnapshot
    let unsubscribe

    beforeEach(() => {
        jest.clearAllMocks()
        resetSecondaryViewCacheForTests()
        unsubscribe = jest.fn()
        const query = {
            where: jest.fn(() => query),
            orderBy: jest.fn(() => query),
            limit: jest.fn(() => query),
            onSnapshot: jest.fn(callback => {
                deliverSnapshot = callback
                return unsubscribe
            }),
        }
        getDb.mockReturnValue({ collection: jest.fn(() => query) })
    })

    afterEach(() => resetSecondaryViewCacheForTests())

    it('renders the cached page without a spinner, then replaces and persists the live snapshot', () => {
        const cacheKey = getChatsViewCacheKey({
            projectId: 'project-1',
            chatsActiveTab: ALL_TAB,
            toRender: 10,
            filtersArray: [],
        })
        const cachedChats = { 20260805: [{ id: 'cached-chat', lastEditionDate: 1785900000000 }] }
        setSecondaryViewCacheEntry(
            'user-1',
            SECONDARY_VIEW_CHATS,
            cacheKey,
            {
                projectId: 'project-1',
                chatsActiveTab: ALL_TAB,
                toRender: 10,
                filtersKey: '[]',
                chats: cachedChats,
            },
            { persist: false }
        )
        const renders = []
        let component

        act(() => {
            component = renderer.create(<HookHarness onRender={value => renders.push(value)} />)
        })

        expect(renders[0]).toEqual(cachedChats)
        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'start-loading' })

        act(() => {
            deliverSnapshot(buildDocs([{ id: 'live-chat', lastEditionDate: 1786000000000, stickyData: { days: 0 } }]))
        })

        expect(
            Object.values(renders[renders.length - 1])
                .flat()
                .map(chat => chat.id)
        ).toEqual(['live-chat'])
        expect(
            Object.values(getSecondaryViewCacheEntrySync('user-1', SECONDARY_VIEW_CHATS, cacheKey).chats)
                .flat()
                .map(chat => chat.id)
        ).toEqual(['live-chat'])

        act(() => component.unmount())
        expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('uses the normal loading lifecycle when there is no projection to render', () => {
        const renders = []

        act(() => {
            renderer.create(<HookHarness onRender={value => renders.push(value)} />)
        })
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'start-loading' })

        act(() => deliverSnapshot(buildDocs([])))

        expect(renders[renders.length - 1]).toEqual({})
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'stop-loading' })
    })
})
