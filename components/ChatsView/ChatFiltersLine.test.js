/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

import ChatFiltersLine from './ChatFiltersLine'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

const renderFilter = ({ notifications, tab = ALL_TAB, unreadOnly = false, setUnreadOnly = jest.fn() }) => {
    const state = { chatsActiveTab: tab, projectChatNotifications: notifications }
    useSelector.mockImplementation(selector => selector(state))
    let component
    act(() => {
        component = renderer.create(
            <ChatFiltersLine projectIds={['project-1']} unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly} />
        )
    })
    return { component, setUnreadOnly }
}

describe('ChatFiltersLine', () => {
    beforeEach(() => jest.clearAllMocks())

    it('is hidden when the current view has no unread threads', () => {
        const { component } = renderFilter({
            notifications: { 'project-1': { totalFollowed: 0, totalUnfollowed: 0 } },
        })

        expect(component.root.findAllByProps({ testID: 'chat-filters' })).toHaveLength(0)
    })

    it('shows the unread thread count and switches between Unread and All', () => {
        const setUnreadOnly = jest.fn()
        const { component } = renderFilter({
            notifications: {
                'project-1': {
                    totalFollowed: 2,
                    totalUnfollowed: 1,
                    chat1: { totalFollowed: 2, totalUnfollowed: 0 },
                    chat2: { totalFollowed: 0, totalUnfollowed: 1 },
                },
            },
            setUnreadOnly,
        })

        expect(
            component.root.findByProps({ testID: 'chat-filter-unread' }).findAllByType('Text')[1].props.children
        ).toBe(2)
        act(() => component.root.findByProps({ testID: 'chat-filter-unread' }).props.onPress())
        expect(setUnreadOnly).toHaveBeenCalledWith(true)
        act(() => component.root.findByProps({ testID: 'chat-filter-all' }).props.onPress())
        expect(setUnreadOnly).toHaveBeenCalledWith(false)
    })

    it('hides unfollowed unread threads in the Followed tab', () => {
        const { component } = renderFilter({
            notifications: {
                'project-1': {
                    totalFollowed: 0,
                    totalUnfollowed: 1,
                    chat1: { totalFollowed: 0, totalUnfollowed: 1 },
                },
            },
            tab: FOLLOWED_TAB,
        })

        expect(component.root.findAllByProps({ testID: 'chat-filters' })).toHaveLength(0)
    })

    it('clears the active filter when its last unread thread is read', () => {
        const setUnreadOnly = jest.fn()
        renderFilter({
            notifications: { 'project-1': { totalFollowed: 0, totalUnfollowed: 0 } },
            unreadOnly: true,
            setUnreadOnly,
        })

        expect(setUnreadOnly).toHaveBeenCalledWith(false)
    })
})
