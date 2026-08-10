/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ChatItem from './ChatItem'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

jest.mock('../UIControls/SocialText/SocialText', () => () => null)
jest.mock('./ChatHeaderItem', () => () => null)
jest.mock('./ChatIndicator', () => () => null)
jest.mock('./ChatItemLastComment', () => () => null)
jest.mock('../Tags/ObjectNoteTag', () => () => null)
jest.mock('../Icon', () => () => null)
jest.mock('../../assets/svg/SVGGenericUser', () => () => null)
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('./Utils/ChatHelper', () => ({ getChatIcon: () => 'chat', onOpenChat: jest.fn() }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ getUserPresentationData: () => ({}) }))
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: () => ({ displayName: 'User', photoURL: null }),
}))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

const PROJECT = { id: 'project-1', index: 0 }
const CHAT = {
    id: 'chat-1',
    title: 'A chat',
    lastEditionDate: 1786000000000,
    type: 'chats',
    stickyData: { days: 0 },
    commentsData: {},
    hasStar: '#FFFFFF',
    members: [],
}

// The nested slices are shared between states so that `isLoadingData` is the only thing that
// varies: a selector returning anything else keeps referential identity, exactly as it would in
// the real store, and so any observed difference is attributable to the loading counter alone.
const LOGGED_USER = { uid: 'user-1' }
const CHAT_NOTIFICATIONS = { 'project-1': { 'chat-1': { totalFollowed: 0, totalUnfollowed: 0 } } }

const buildState = isLoadingData => ({
    loggedUser: LOGGED_USER,
    isLoadingData,
    showFloatPopup: false,
    projectChatNotifications: CHAT_NOTIFICATIONS,
})

// Captures every selector ChatItem hands to useSelector during one render.
const captureSelectors = state => {
    const selectors = []
    useSelector.mockImplementation(selector => {
        selectors.push(selector)
        return selector(state)
    })

    act(() => {
        renderer.create(<ChatItem chat={CHAT} project={PROJECT} openEditModal={jest.fn()} />)
    })

    return selectors
}

describe('ChatItem loading-state subscription', () => {
    beforeEach(() => jest.clearAllMocks())

    /**
     * "All Projects > Chats" mounts one ChatsByProject per project, and each starts two listeners
     * that increment the global `isLoadingData` reference count. For a 78-project account the
     * counter therefore steps through ~156 distinct positive values on the way up and back down,
     * each from a Firestore snapshot callback that React cannot batch.
     *
     * react-redux re-renders a subscriber whenever its selector returns a new value, so selecting
     * the raw counter re-rendered every mounted ChatItem on each of those steps. ChatItem only ever
     * renders `!isLoadingData`, so the selector must collapse to a boolean. See AT-2200.
     */
    it('does not observe changes in the loading counter between two positive values', () => {
        const selectors = captureSelectors(buildState(1))

        expect(selectors.length).toBeGreaterThan(0)
        selectors.forEach(selector => {
            // Strict identity: this is the comparison react-redux itself uses to skip a re-render.
            expect(selector(buildState(5))).toBe(selector(buildState(1)))
        })
    })

    it('still distinguishes loading from idle', () => {
        const selectors = captureSelectors(buildState(1))

        const loadingAware = selectors.filter(selector => selector(buildState(0)) !== selector(buildState(1)))
        expect(loadingAware).toHaveLength(1)
        // The value reaching the component is the boolean, not the count.
        expect(loadingAware[0](buildState(1))).toBe(true)
        expect(loadingAware[0](buildState(0))).toBe(false)
    })
})
