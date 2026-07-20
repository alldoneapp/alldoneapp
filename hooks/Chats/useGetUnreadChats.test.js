/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useGetUnreadChats, { groupUnreadChats } from './useGetUnreadChats'
import { ALL_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import { getDb } from '../../utils/backends/firestore'

jest.mock('../../components/HashtagFilters/UseSelectorHashtagFilters', () => () => [new Map(), []])
jest.mock('../../components/HashtagFilters/FilterHelpers/FilterChats', () => ({
    filterChats: chats => chats,
    filterStickyChats: chats => chats,
}))
jest.mock('../../utils/backends/firestore', () => ({ getDb: jest.fn() }))

const notifications = {
    totalFollowed: 1,
    totalUnfollowed: 1,
    regular: { totalFollowed: 1, totalUnfollowed: 0 },
    sticky: { totalFollowed: 0, totalUnfollowed: 1 },
}

const createDoc = (id, data) => ({ id, exists: true, data: () => data })

function HookHarness({ enabled, onRender }) {
    onRender(useGetUnreadChats('project-1', notifications, ALL_TAB, enabled))
    return null
}

describe('useGetUnreadChats', () => {
    beforeEach(() => jest.clearAllMocks())

    it('groups exact unread documents into regular and sticky chats', () => {
        const grouped = groupUnreadChats([
            createDoc('regular', { lastEditionDate: 1784512800000, stickyData: { days: 0 } }),
            createDoc('sticky', { lastEditionDate: 1784512800000, stickyData: { days: 2 } }),
        ])

        expect(grouped.chats['20260720'][0].id).toBe('regular')
        expect(grouped.stickyChats[0].id).toBe('sticky')
    })

    it('does not restart the paginated chat queries when switching Unread to All', async () => {
        const get = jest.fn(id =>
            Promise.resolve(
                createDoc(id, {
                    lastEditionDate: 1784512800000,
                    stickyData: { days: id === 'sticky' ? 1 : 0 },
                })
            )
        )
        getDb.mockReturnValue({
            doc: path => ({ get: () => get(path.split('/').pop()) }),
        })
        const renders = []
        let component

        await act(async () => {
            component = renderer.create(<HookHarness enabled onRender={value => renders.push(value)} />)
        })
        expect(get).toHaveBeenCalledTimes(2)
        expect(renders[renders.length - 1].stickyChats[0].id).toBe('sticky')

        await act(async () => {
            component.update(<HookHarness enabled={false} onRender={value => renders.push(value)} />)
        })

        expect(get).toHaveBeenCalledTimes(2)
        expect(renders[renders.length - 1]).toEqual({ chats: {}, stickyChats: [] })
    })
})
